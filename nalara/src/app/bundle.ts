/**
 * File bundles for the desktop app: a directory packed into one JSON object (relative path -> base64), so the
 * UI and the sample project travel inside the executable as two assets and are unpacked on the user's machine.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Relative path (forward slashes) -> file content, base64. */
export type FileBundle = Record<string, string>;

/** Directory names never packed: dependencies, VCS data and Nalara's own data folder. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".nalara"]);

export function packDir(dir: string): FileBundle {
  const root = resolve(dir);
  const out: FileBundle = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else if (st.isFile()) {
        out[relative(root, full).split(sep).join("/")] = readFileSync(full).toString("base64");
      }
    }
  };
  walk(root);
  return out;
}

/** Short content hash, used to name the folder an unpacked bundle lives in. */
export function bundleHash(bundle: FileBundle): string {
  const h = createHash("sha256");
  for (const key of Object.keys(bundle).sort()) h.update(key).update("\0").update(bundle[key]).update("\0");
  return h.digest("hex").slice(0, 16);
}

/**
 * Writes every file of the bundle under `dir`. Paths that would leave `dir` (absolute, or with "..") are
 * refused, so a damaged bundle cannot write elsewhere. Returns the number of files written.
 */
export function unpackTo(bundle: FileBundle, dir: string): number {
  const root = resolve(dir);
  let n = 0;
  for (const [rel, data] of Object.entries(bundle)) {
    const target = resolve(root, rel);
    if (rel.startsWith("/") || rel.includes("\\") || (target !== root && !target.startsWith(root + sep))) throw new Error(`Refusing to unpack "${rel}": it leaves ${root}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(data, "base64"));
    n++;
  }
  return n;
}

/** Unpacks the bundle into `<parent>/<hash>` once; later calls reuse the folder. Returns that folder. */
export function unpackOnce(bundle: FileBundle, parent: string): string {
  const dir = join(parent, bundleHash(bundle));
  const marker = join(dir, ".complete");
  if (!existsSync(marker)) {
    unpackTo(bundle, dir);
    writeFileSync(marker, new Date().toISOString());
  }
  return dir;
}
