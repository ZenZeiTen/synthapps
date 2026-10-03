/**
 * Builds the Nalara desktop app: one executable that starts the kernel and opens the UI in its own window.
 *
 *   npm run build:app                          for this computer (Linux, Windows or macOS)
 *   npm run build:app -- --target win-x64      a Windows build from Linux or macOS (downloads node.exe)
 *   npm run build:app -- --target linux-x64    a Linux build from another system (downloads Node for Linux)
 *
 * macOS builds must run on a Mac: the executable has to be re-signed with `codesign` after the app is injected.
 *
 * Steps: build the UI (vite) -> bundle src/app/launcher.ts with esbuild into one CommonJS file -> pack the UI and
 * the sample project as assets -> make a Node SEA blob -> copy a Node binary of the same version -> inject the
 * blob with postject -> package it for people to download:
 *
 *   dist-app/Nalara-win-x64.exe              Windows: the executable itself
 *   dist-app/Nalara-darwin-arm64.zip         macOS: Nalara.app (double-click, no Terminal window), zipped with ditto
 *   dist-app/Nalara-linux-x64.tar.gz         Linux: the executable, with its executable bit kept
 *
 * The bare executable (dist-app/Nalara-<target>) is left beside the package for the self-test (--check).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { packDir } from "../src/app/bundle";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist-app");
const WORK = join(OUT, "work");
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const TARGETS = ["linux-x64", "linux-arm64", "win-x64", "win-arm64", "darwin-x64", "darwin-arm64"] as const;
type Target = (typeof TARGETS)[number];

function hostTarget(): Target {
  const os = platform() === "win32" ? "win" : platform();
  const t = `${os}-${arch()}`;
  if (!(TARGETS as readonly string[]).includes(t)) throw new Error(`Unsupported build host ${t}`);
  return t as Target;
}

function parseArgs(argv: string[]): { target: Target; skipUi: boolean } {
  let target = hostTarget();
  let skipUi = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") {
      const t = argv[++i];
      if (!(TARGETS as readonly string[]).includes(t)) throw new Error(`--target must be one of ${TARGETS.join(", ")}`);
      target = t as Target;
    } else if (argv[i] === "--skip-ui") skipUi = true;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return { target, skipUi };
}

function run(cmd: string, args: string[], opts: { cwd?: string; shell?: boolean } = {}) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: opts.cwd ?? ROOT, shell: opts.shell ?? false });
}

async function download(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** A Node binary for the target, the same version as the one running this script, checked against SHASUMS256. */
async function nodeBinary(target: Target, dest: string): Promise<void> {
  if (target === hostTarget()) {
    copyFileSync(process.execPath, dest);
    return;
  }
  if (target.startsWith("darwin")) throw new Error("macOS builds must run on a Mac (the binary needs codesign after injection)");
  const v = process.version;
  const base = `https://nodejs.org/dist/${v}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString("utf8");
  const verify = (data: Buffer, name: string) => {
    const want = sums.split("\n").find((l) => l.trim().endsWith(`  ${name}`))?.split(/\s+/)[0];
    const got = createHash("sha256").update(data).digest("hex");
    if (!want || want !== got) throw new Error(`Checksum mismatch for ${name}`);
  };
  if (target.startsWith("win")) {
    const name = `${target}/node.exe`;
    const data = await download(`${base}/${name}`);
    verify(data, name);
    writeFileSync(dest, data);
    return;
  }
  const name = `node-${v}-${target}.tar.xz`;
  const data = await download(`${base}/${name}`);
  verify(data, name);
  const tarball = join(WORK, name);
  writeFileSync(tarball, data);
  run("tar", ["-xJf", tarball, "-C", WORK, `node-${v}-${target}/bin/node`]);
  copyFileSync(join(WORK, `node-${v}-${target}`, "bin", "node"), dest);
}

async function main() {
  const { target, skipUi } = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  console.log(`Building Nalara ${pkg.version} for ${target} with Node ${process.version}`);

  if (!skipUi) run("npm", ["run", "build"], { shell: process.platform === "win32" });
  if (!existsSync(join(ROOT, "web", "dist", "index.html"))) throw new Error("web/dist is missing; run npm run build");

  const main = join(WORK, "nalara.cjs");
  await build({
    entryPoints: [join(ROOT, "src", "app", "launcher.ts")],
    outfile: main,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: `node${process.versions.node.split(".")[0]}`,
    define: { "process.env.NALARA_BUNDLED_VERSION": JSON.stringify(pkg.version) },
    // import.meta.url is only read when running from source, never inside the executable.
    logOverride: { "empty-import-meta": "silent" },
    legalComments: "eof",
  });

  writeFileSync(join(WORK, "ui.json"), JSON.stringify(packDir(join(ROOT, "web", "dist"))));
  writeFileSync(join(WORK, "sample.json"), JSON.stringify(packDir(join(ROOT, "demo", "breath-of-fire-iv-remake"))));
  const blob = join(WORK, "sea-prep.blob");
  writeFileSync(
    join(WORK, "sea-config.json"),
    JSON.stringify({
      main,
      output: blob,
      disableExperimentalSEAWarning: true,
      // The code cache is specific to the platform that builds it; leave it off so cross-builds work.
      useCodeCache: false,
      useSnapshot: false,
      assets: { "ui.json": join(WORK, "ui.json"), "sample.json": join(WORK, "sample.json") },
    }),
  );
  run(process.execPath, ["--experimental-sea-config", join(WORK, "sea-config.json")]);

  const exe = join(OUT, `Nalara-${target}${target.startsWith("win") ? ".exe" : ""}`);
  rmSync(exe, { force: true });
  await nodeBinary(target, exe);
  chmodSync(exe, 0o755);
  const isMac = target.startsWith("darwin");
  if (isMac) run("codesign", ["--remove-signature", exe]);
  const { inject } = await import("postject");
  await inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: SEA_FUSE, ...(isMac ? { machoSegmentName: "NODE_SEA" } : {}) });
  if (isMac) run("codesign", ["--sign", "-", exe]);

  const pkgFile = packageFor(target, exe, pkg.version);
  rmSync(WORK, { recursive: true, force: true });
  const mb = (f: string) => `${(statSync(f).size / 1024 / 1024).toFixed(1)} MB`;
  console.log(`\nBuilt ${exe} (${mb(exe)})`);
  if (pkgFile !== exe) console.log(`Package: ${pkgFile} (${mb(pkgFile)})`);
}

function infoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Nalara</string>
  <key>CFBundleDisplayName</key><string>Nalara</string>
  <key>CFBundleIdentifier</key><string>local.nalara.desktop</string>
  <key>CFBundleExecutable</key><string>Nalara</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

/** Wraps the executable the way each system expects a downloaded app. Returns the file to distribute. */
function packageFor(target: Target, exe: string, version: string): string {
  if (target.startsWith("win")) return exe;
  if (target.startsWith("darwin")) {
    const stage = join(WORK, "mac");
    const app = join(stage, "Nalara.app");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    copyFileSync(exe, join(app, "Contents", "MacOS", "Nalara"));
    chmodSync(join(app, "Contents", "MacOS", "Nalara"), 0o755);
    writeFileSync(join(app, "Contents", "Info.plist"), infoPlist(version));
    run("codesign", ["--force", "--sign", "-", app]);
    const zip = join(OUT, `Nalara-${target}.zip`);
    rmSync(zip, { force: true });
    run("ditto", ["-c", "-k", "--keepParent", app, zip]);
    return zip;
  }
  const tgz = join(OUT, `Nalara-${target}.tar.gz`);
  rmSync(tgz, { force: true });
  run("tar", ["-czf", tgz, "-C", OUT, basename(exe)]);
  return tgz;
}

main().catch((err: unknown) => {
  console.error(`build-app: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
