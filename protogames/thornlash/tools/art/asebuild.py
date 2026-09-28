"""Assemble painted frames into an editable .aseprite source, then export the game sheet
FROM that source (so a hand edit made in Aseprite is what ships).

  python tools/art/asebuild.py assemble hero      # art/build/hero/*.png -> art/hero.aseprite
  python tools/art/asebuild.py export hero        # art/hero.aseprite -> godot/content/art/hero.png/.json

The game JSON holds per-frame rects, the pivot (feet or grip) and extra anchors (hand)
from art/<name>.rig.json, and one animation per tag with ms durations.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASEPRITE = r"C:\Program Files\Aseprite\Aseprite.exe"
ART = ROOT / "art"
OUT = ROOT / "godot" / "content" / "art"


def lua_str(s):
    return '"' + str(s).replace("\\", "/").replace('"', '\\"') + '"'


def assemble(name):
    build = ART / "build" / name
    meta = json.loads((build / "frames.json").read_text())
    W, H = meta["size"]
    pal = meta.get("palette", [])
    lines = [
        "local frames = {",
        *[f"  {{file={lua_str(build / f['file'])}, ms={int(f['ms'])}}}," for f in meta["frames"]],
        "}",
        "local tags = {",
        *[f"  {{name={lua_str(t['name'])}, from={t['from'] + 1}, to={t['to'] + 1}}}," for t in meta["tags"]],
        "}",
        "local pal = {" + ",".join(lua_str(c) for c in pal) + "}",
        f"local spr = Sprite({W}, {H}, ColorMode.RGB)",
        "app.transaction('build', function()",
        "  if #pal > 0 then",
        "    local p = Palette(#pal + 1)",
        "    p:setColor(0, Color{r=0,g=0,b=0,a=0})",
        "    for i, h in ipairs(pal) do",
        "      p:setColor(i, Color{r=tonumber(h:sub(2,3),16), g=tonumber(h:sub(4,5),16), b=tonumber(h:sub(6,7),16), a=255})",
        "    end",
        "    spr:setPalette(p)",
        "  end",
        "  spr.layers[1].name = 'art'",
        "  for i, f in ipairs(frames) do",
        "    if i > 1 then spr:newEmptyFrame() end",
        "    local img = Image{fromFile=f.file}",
        "    spr:newCel(spr.layers[1], i, img, Point(0, 0))",
        "    spr.frames[i].duration = f.ms / 1000.0",
        "  end",
        "  for _, t in ipairs(tags) do",
        "    local tg = spr:newTag(t.from, t.to)",
        "    tg.name = t.name",
        "  end",
        "end)",
        f"spr:saveAs({lua_str(ART / (name + '.aseprite'))})",
        "spr:close()",
        "print('assembled ' .. #frames .. ' frames')",
    ]
    lua = ART / "build" / f"{name}_assemble.lua"
    lua.write_text("\n".join(lines), encoding="utf8")
    r = subprocess.run([ASEPRITE, "-b", "--script", str(lua)], capture_output=True, text=True, timeout=300)
    print(r.stdout.strip(), r.stderr.strip())
    # rig data (pivots, hand anchors) lives beside the source, keyed by frame index
    rig = {"pivot": meta.get("pivot", [W // 2, H - 2]), "frames": {}}
    for i, f in enumerate(meta["frames"]):
        ent = {}
        if "pivot" in f:
            ent["pivot"] = f["pivot"]
        if "hand" in f:
            ent["hand"] = f["hand"]
        if ent:
            rig["frames"][str(i)] = ent
    loops = {t["name"]: t.get("loop", True) for t in meta["tags"]}
    rig["loops"] = loops
    (ART / f"{name}.rig.json").write_text(json.dumps(rig, indent=1))
    if not (ART / f"{name}.aseprite").exists():
        sys.exit("assemble failed: no .aseprite written")


def export(name, columns=16):
    src = ART / f"{name}.aseprite"
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = OUT / f"{name}.png"
    data = ART / "build" / f"{name}_sheet.json"
    cmd = [ASEPRITE, "-b", str(src), "--sheet", str(sheet), "--data", str(data), "--format", "json-array",
           "--list-tags", "--sheet-type", "rows", "--sheet-columns", str(columns), "--shape-padding", "1"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        sys.exit("export failed: " + r.stderr)
    j = json.loads(data.read_text())
    rig = json.loads((ART / f"{name}.rig.json").read_text())
    base_pivot = rig["pivot"]
    frames = {}
    for i, f in enumerate(j["frames"]):
        fr = f["frame"]
        extra = rig["frames"].get(str(i), {})
        piv = extra.get("pivot", base_pivot)
        ent = {"x": fr["x"], "y": fr["y"], "w": fr["w"], "h": fr["h"], "ox": piv[0], "oy": piv[1]}
        if "hand" in extra:
            ent["hx"], ent["hy"] = extra["hand"]
        frames[f"{name}_{i:03d}"] = (ent, f["duration"])
    anims = {}
    for t in j["meta"]["frameTags"]:
        ids = list(range(t["from"], t["to"] + 1))
        anims[f"{name}_{t['name']}" if name == "hero" else t["name"]] = {
            "frames": [f"{name}_{i:03d}" for i in ids],
            "ms": [frames[f"{name}_{i:03d}"][1] for i in ids],
            "loop": rig.get("loops", {}).get(t["name"], True),
        }
    # whip frames are looked up by bare name (whip2_out ...): alias single-frame tags
    out_frames = {k: v[0] for k, v in frames.items()}
    for an, a in list(anims.items()):
        short = an.replace("hero_", "")
        if short.startswith("whip") and "_" in short and len(a["frames"]) == 1:
            out_frames[short] = out_frames[a["frames"][0]]
    (OUT / f"{name}.json").write_text(json.dumps({"frames": out_frames, "anims": anims}, indent=0))
    print(f"exported {sheet.name}: {len(frames)} frames, {len(anims)} animations")


if __name__ == "__main__":
    cmd, name = sys.argv[1], sys.argv[2]
    if cmd == "assemble":
        assemble(name)
    elif cmd == "export":
        export(name)
    elif cmd == "all":
        assemble(name)
        export(name)
    else:
        sys.exit("usage: asebuild.py assemble|export|all <name>")
