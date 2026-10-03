import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleHash, packDir, unpackOnce, unpackTo } from "../src/app/bundle";
import { appWindowArgs, browserCandidates, DEFAULT_APP_PORT, dialogText, findBrowser, main, parseArgs, prepareHome } from "../src/app/launcher";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "nos-launch-"));
  temps.push(d);
  return d;
};

describe("file bundles", () => {
  it("packs a folder (skipping node_modules, .git, .nalara and symlinks) and unpacks it byte for byte", () => {
    const src = tmp();
    mkdirSync(path.join(src, "a", "b"), { recursive: true });
    writeFileSync(path.join(src, "a", "b", "x.txt"), "hello");
    writeFileSync(path.join(src, "bin.dat"), Buffer.from([0, 255, 1, 254]));
    for (const skip of ["node_modules", ".git", ".nalara"]) {
      mkdirSync(path.join(src, skip));
      writeFileSync(path.join(src, skip, "f"), "no");
    }
    symlinkSync(path.join(src, "bin.dat"), path.join(src, "link"));
    const bundle = packDir(src);
    expect(Object.keys(bundle).sort()).toEqual(["a/b/x.txt", "bin.dat"]);
    const out = tmp();
    expect(unpackTo(bundle, out)).toBe(2);
    expect(readFileSync(path.join(out, "a", "b", "x.txt"), "utf8")).toBe("hello");
    expect([...readFileSync(path.join(out, "bin.dat"))]).toEqual([0, 255, 1, 254]);
  });

  it("refuses paths that leave the target folder", () => {
    const out = tmp();
    const data = Buffer.from("x").toString("base64");
    for (const bad of ["../escape.txt", "/etc/escape", "a/../../escape", "a\\..\\escape"]) expect(() => unpackTo({ [bad]: data }, out)).toThrow(/leaves/);
    expect(existsSync(path.join(out, "..", "escape.txt"))).toBe(false);
  });

  it("unpacks once per content hash", () => {
    const parent = tmp();
    const bundle = { "index.html": Buffer.from("<div id=\"root\"></div>").toString("base64") };
    const dir = unpackOnce(bundle, parent);
    expect(path.basename(dir)).toBe(bundleHash(bundle));
    writeFileSync(path.join(dir, "index.html"), "changed");
    expect(unpackOnce(bundle, parent)).toBe(dir);
    expect(readFileSync(path.join(dir, "index.html"), "utf8")).toBe("changed");
    expect(bundleHash({ "index.html": Buffer.from("other").toString("base64") })).not.toBe(bundleHash(bundle));
  });
});

describe("launcher options", () => {
  it("defaults to ~/Nalara on the standard port with a window", () => {
    const o = parseArgs([], {}, "/home/ana");
    expect(o).toMatchObject({ root: path.resolve("/home/ana/Nalara"), port: DEFAULT_APP_PORT, open: true, stay: false, sample: true, check: false });
  });

  it("reads flags and environment, and rejects bad input", () => {
    const o = parseArgs(["--root", "/data/n", "--port", "0", "--fullscreen", "--no-open", "--stay", "--offline", "--no-sample", "-psn_0_123"], { NALARA_BROWSER: "/opt/chrome" }, "/home/ana");
    expect(o).toMatchObject({ root: path.resolve("/data/n"), port: 0, fullscreen: true, open: false, stay: true, offline: true, sample: false, browser: "/opt/chrome" });
    expect(parseArgs([], { NALARA_ROOT: "/srv/nalara" }, "/home/ana")).toMatchObject({ root: path.resolve("/srv/nalara") });
    expect(parseArgs(["--help"])).toBe("help");
    expect(() => parseArgs(["--port", "99999"])).toThrow(/whole number/);
    expect(() => parseArgs(["--root"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown option/);
  });
});

describe("app window", () => {
  it("looks for Edge and Chrome in the standard Windows folders", () => {
    const list = browserCandidates("win32", { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" });
    expect(list[0]).toBe("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(list).toContain("C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
  });

  it("looks in /Applications on macOS and on PATH on Linux", () => {
    expect(browserCandidates("darwin", { HOME: "/Users/a" })).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    const linux = browserCandidates("linux", { PATH: "/usr/local/bin:/usr/bin" });
    expect(linux).toContain("/usr/bin/chromium");
    expect(findBrowser("linux", { PATH: "/usr/local/bin:/usr/bin" }, (p) => p === "/usr/bin/microsoft-edge")).toBe("/usr/bin/microsoft-edge");
    expect(findBrowser("linux", { PATH: "/usr/bin" }, () => false)).toBeUndefined();
  });

  it("opens an app window with its own profile", () => {
    expect(appWindowArgs("http://127.0.0.1:7437", "/p", false)).toEqual(["--app=http://127.0.0.1:7437", "--user-data-dir=/p", "--no-first-run", "--no-default-browser-check", "--window-size=1600,940"]);
    expect(appWindowArgs("http://x", "/p", true)).toContain("--start-fullscreen");
  });
});

describe("error dialog text", () => {
  it("is one line without quotes or backslashes, so osascript and zenity show it literally", () => {
    expect(dialogText('Could not start the server:\nlisten EACCES "C:\\x"')).toBe("Could not start the server: listen EACCES 'C:'x'");
    expect(dialogText("x".repeat(900))).toHaveLength(500);
  });
});

describe("home folder", () => {
  it("is created with the sample project on the first run and left alone afterwards", () => {
    const root = path.join(tmp(), "Nalara");
    let calls = 0;
    const sample = () => {
      calls++;
      return { "README.md": Buffer.from("# sample").toString("base64") };
    };
    expect(prepareHome(root, true, sample)).toBe(true);
    expect(readFileSync(path.join(root, "breath-of-fire-iv-remake", "README.md"), "utf8")).toBe("# sample");
    expect(prepareHome(root, true, sample)).toBe(false);
    expect(calls).toBe(1);
    const bare = path.join(tmp(), "Bare");
    expect(prepareHome(bare, false, sample)).toBe(true);
    expect(calls).toBe(1);
  });

  it("refuses a home path that is a file", () => {
    const file = path.join(tmp(), "file");
    writeFileSync(file, "x");
    expect(() => prepareHome(file, true, () => ({}))).toThrow(/not a folder/);
  });
});

const UI_BUILT = existsSync(path.resolve(__dirname, "../web/dist/index.html"));

describe("self-test", () => {
  it.skipIf(!UI_BUILT)("starts the kernel in a temporary folder, checks the API, search and UI, and exits 0 (needs npm run build)", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      expect(await main(["--check"])).toBe(0);
    } finally {
      console.log = log;
    }
    expect(lines.join("\n")).toMatch(/Nalara check passed: api .*files indexed, mode offline; search -> .*battle_system\.ts; ui served/);
  }, 60_000);
});
