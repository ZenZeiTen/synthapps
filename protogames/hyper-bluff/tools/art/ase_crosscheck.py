#!/usr/bin/env python3
"""Cross-check asefile.py against the real Aseprite.

    python3 tools/art/ase_crosscheck.py [path-to-aseprite-binary] [--dir DIR]

For every *.aseprite under hyper-bluff/art/ (or DIR), recursively, real Aseprite is run in
batch mode to export each frame to PNG (--save-as) and to dump the sprite's metadata (a Lua
script, embedded below). The result is compared with what asefile.Sprite.load() reports:
canvas size, colour mode, frame count, frame durations, layer names (bottom to top, groups
before their children, as in the file), tags, palette, and every flattened frame pixel by pixel.

The binary comes from the first argument, else the ASEPRITE environment variable, else an
`aseprite` on PATH. With none of these the check is skipped (exit 0) so the test run still
works on a machine without Aseprite. A binary that is named but missing is an error (exit 2).

Aseprite is not part of this repository. Build it for your own use from its public source
(see docs); do not commit the binary or its source here.

Exit status: 0 = all files match (or skipped), 1 = at least one mismatch, 2 = bad usage.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asefile  # noqa: E402
from PIL import Image  # noqa: E402

DEFAULT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "art"))

# Runs inside Aseprite (aseprite -b FILE --script-param out=META.json --script this.lua).
# It writes JSON itself so that it also works on builds without the `json` module.
DUMP_LUA = r"""
local spr = app.sprite
if not spr then error("ase_crosscheck: no sprite is open") end

local function q(s)
  s = s:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end)
  return '"' .. s .. '"'
end

local modes = { [ColorMode.RGB] = "rgb", [ColorMode.GRAY] = "gray", [ColorMode.INDEXED] = "indexed" }

local durations = {}
for i, fr in ipairs(spr.frames) do
  durations[i] = string.format("%d", math.floor(fr.duration * 1000 + 0.5))
end

local layers = {}
local function walk(list)
  for _, l in ipairs(list) do
    layers[#layers + 1] = string.format('{"name":%s,"group":%s,"visible":%s}',
      q(l.name), tostring(l.isGroup), tostring(l.isVisible))
    if l.isGroup then walk(l.layers) end
  end
end
walk(spr.layers)

local tags = {}
for i, t in ipairs(spr.tags) do
  tags[i] = string.format('{"name":%s,"from":%d,"to":%d}',
    q(t.name), t.fromFrame.frameNumber - 1, t.toFrame.frameNumber - 1)
end

local palette = {}
local pal = spr.palettes[1]
for i = 0, #pal - 1 do
  local c = pal:getColor(i)
  palette[#palette + 1] = string.format("[%d,%d,%d,%d]", c.red, c.green, c.blue, c.alpha)
end

local f = assert(io.open(app.params["out"], "w"))
f:write(string.format(
  '{"version":%s,"width":%d,"height":%d,"mode":%s,"frames":%d,' ..
  '"durations":[%s],"layers":[%s],"tags":[%s],"palette":[%s]}\n',
  q(tostring(app.version)), spr.width, spr.height, q(modes[spr.colorMode] or "?"), #spr.frames,
  table.concat(durations, ","), table.concat(layers, ","), table.concat(tags, ","),
  table.concat(palette, ",")))
f:close()
"""


def find_binary(arg):
    """Return (path or None, error text or None)."""
    named = arg or os.environ.get("ASEPRITE")
    if named:
        path = named if os.path.sep in named else (shutil.which(named) or named)
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path, None
        return None, f"Aseprite binary not found or not executable: {named}"
    return shutil.which("aseprite"), None


def find_files(root):
    found = []
    for base, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            if name.lower().endswith(".aseprite"):
                found.append(os.path.join(base, name))
    return found


def run_aseprite(binary, args, env):
    proc = subprocess.run([binary, "-b"] + args, env=env, timeout=180,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    return proc.returncode, proc.stdout.strip()


def same_pixels(a, b):
    """Compare two RGBA images; fully transparent pixels are equal whatever their colour.
    Returns None when equal, else a short description of the difference."""
    if a.size != b.size:
        return f"size {a.size[0]}x{a.size[1]} vs {b.size[0]}x{b.size[1]}"
    if a.tobytes() == b.tobytes():
        return None
    pa, pb = a.load(), b.load()
    count, first = 0, None
    for y in range(a.size[1]):
        for x in range(a.size[0]):
            va, vb = pa[x, y], pb[x, y]
            if va != vb and not (va[3] == 0 and vb[3] == 0):
                count += 1
                if first is None:
                    first = (x, y, va, vb)
    if not count:
        return None
    x, y, va, vb = first
    return f"{count} pixels differ, first at ({x},{y}): Aseprite {va} vs asefile {vb}"


def check_file(binary, path, work, lua_path, env):
    """Return (summary text, list of mismatches) for one file."""
    problems = []
    meta_path = os.path.join(work, "meta.json")
    code, out = run_aseprite(binary, [path, "--script-param", "out=" + meta_path, "--script", lua_path,
                                      "--save-as", os.path.join(work, "frame_{frame}.png")], env)
    if code != 0 or not os.path.isfile(meta_path):
        return "", [f"Aseprite could not open/export it (exit {code}): {out[-300:]}"]
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)
    summary = "%dx%d, %d frames, %d layers, %d tags" % (
        meta["width"], meta["height"], meta["frames"], len(meta["layers"]), len(meta["tags"]))

    try:
        spr = asefile.Sprite.load(path)
    except Exception as exc:  # the reader rejects what it does not support; that is a finding
        return summary, [f"asefile.py cannot load it ({type(exc).__name__}: {exc}); "
                         f"Aseprite says colour mode {meta['mode']}"]

    def differ(what, ase, ours):
        if ase != ours:
            problems.append(f"{what}: Aseprite {ase!r} vs asefile {ours!r}")

    differ("canvas size", [meta["width"], meta["height"]], [spr.w, spr.h])
    differ("colour mode", meta["mode"], "rgb")
    differ("frame count", meta["frames"], len(spr.durations))
    differ("durations (ms)", meta["durations"], list(spr.durations))
    differ("layer names", [la["name"] for la in meta["layers"]], [la["name"] for la in spr.layers])
    differ("tags", [(t["name"], t["from"], t["to"]) for t in meta["tags"]],
           [(t["name"], t["from"], t["to"]) for t in spr.tags])
    # A file saved with no palette chunk (asefile.py writes none for an empty palette) gets a
    # palette invented by Aseprite on load, so there is nothing to compare in that case.
    if spr.palette:
        differ("palette", ["#%02x%02x%02x" % (r, g, b) for r, g, b, a in meta["palette"] if a > 0],
               [c.lower() for c in spr.palette])

    for f in range(min(meta["frames"], len(spr.durations))):
        png = os.path.join(work, f"frame_{f}.png")
        if not os.path.isfile(png):
            problems.append(f"frame {f}: Aseprite wrote no PNG for it")
            continue
        with Image.open(png) as im:
            theirs = im.convert("RGBA")
        diff = same_pixels(theirs, spr.flatten(f))
        if diff:
            problems.append(f"frame {f} pixels: {diff}")
    return summary, problems


def main(argv):
    ap = argparse.ArgumentParser(description="Cross-check asefile.py against real Aseprite.")
    ap.add_argument("binary", nargs="?", help="path to the aseprite binary (or set ASEPRITE)")
    ap.add_argument("--dir", default=DEFAULT_DIR, help="folder to scan for *.aseprite (default: art/)")
    opts = ap.parse_args(argv)

    binary, err = find_binary(opts.binary)
    if err:
        print("ASECHECK error:", err)
        return 2
    if not binary:
        print("ASECHECK skipped: no Aseprite binary")
        return 0
    if not os.path.isdir(opts.dir):
        print(f"ASECHECK error: no such folder: {opts.dir}")
        return 2

    files = find_files(opts.dir)
    failed = []
    with tempfile.TemporaryDirectory(prefix="asecheck_") as tmp:
        # Aseprite keeps its own settings out of the user's ~/.config while we test.
        env = dict(os.environ, ASEPRITE_USER_FOLDER=os.path.join(tmp, "userdir"))
        os.makedirs(env["ASEPRITE_USER_FOLDER"])
        code, version = run_aseprite(binary, ["--version"], env)
        if code != 0 or "Aseprite" not in version:
            print(f"ASECHECK error: {binary} --version failed (exit {code}): {version[-200:]}")
            return 2
        print(f"ASECHECK using {version.splitlines()[-1]} ({binary})")
        lua_path = os.path.join(tmp, "ase_dump.lua")
        with open(lua_path, "w", encoding="utf-8") as fh:
            fh.write(DUMP_LUA)
        for i, path in enumerate(files):
            work = os.path.join(tmp, f"f{i}")
            os.makedirs(work)
            rel = os.path.relpath(path, opts.dir)
            try:
                summary, problems = check_file(binary, path, work, lua_path, env)
            except subprocess.TimeoutExpired:
                summary, problems = "", ["Aseprite timed out"]
            if problems:
                failed.append((rel, problems))
                print(f"FAIL {rel}" + (f" ({summary})" if summary else ""))
                for p in problems:
                    print(f"       {p}")
            else:
                print(f"ok   {rel} ({summary})")

    if failed:
        print(f"ASECHECK FAILED: {len(failed)} of {len(files)} files differ")
        for rel, problems in failed:
            for p in problems:
                print(f"  {rel}: {p}")
        return 1
    print(f"ASECHECK ok: {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
