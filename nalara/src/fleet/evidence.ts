/**
 * Evidence check: the platform, not the agent, decides whether a finding's citation holds.
 *
 * A finding that names a file is "verified" when that file exists under the root (after resolving symlinks) and the
 * cited line, if any, is inside it. Anything else is "unverified"; a finding that cites nothing has evidence "none".
 * Disagreements between builders and critics are settled on this basis: only verified challenges can block a step.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { EvidenceStatus, Finding } from "../kernel/types";

/** Files larger than this are not read to count lines; the file itself still counts as cited evidence. */
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export interface EvidenceResult {
  status: EvidenceStatus;
  note: string;
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function createEvidenceChecker(root: string): (finding: Pick<Finding, "file" | "line">) => Promise<EvidenceResult> {
  const base = resolve(root);
  let realBase: string | undefined;

  return async (finding) => {
    const cited = typeof finding.file === "string" ? finding.file.trim() : "";
    if (!cited) return { status: "none", note: "no file cited" };
    if (cited.includes("\0") || isAbsolute(cited)) return { status: "unverified", note: `cited path ${cited} is not relative to the project root` };
    const target = resolve(base, cited);
    if (!inside(base, target)) return { status: "unverified", note: `cited path ${cited} is outside the project root` };
    let real: string;
    try {
      realBase ??= await realpath(base);
      real = await realpath(target);
    } catch {
      return { status: "unverified", note: `cited file ${cited} does not exist` };
    }
    if (!inside(realBase, real)) return { status: "unverified", note: `cited file ${cited} resolves outside the project root` };
    let size: number;
    try {
      const st = await stat(real);
      if (!st.isFile()) return { status: "unverified", note: `cited path ${cited} is not a file` };
      size = st.size;
    } catch {
      return { status: "unverified", note: `cited file ${cited} cannot be read` };
    }
    if (finding.line === undefined) return { status: "verified", note: `${cited} exists` };
    if (!Number.isInteger(finding.line) || finding.line < 1) return { status: "unverified", note: `cited line ${String(finding.line)} is not a line number` };
    if (size > MAX_EVIDENCE_BYTES) return { status: "verified", note: `${cited} exists (too large to check line ${finding.line})` };
    const content = await readFile(real, "utf8").catch(() => null);
    if (content === null) return { status: "unverified", note: `cited file ${cited} cannot be read` };
    const lines = content === "" ? 0 : content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0);
    if (finding.line > lines) return { status: "unverified", note: `cited line ${finding.line} is past the end of ${cited} (${lines} lines)` };
    return { status: "verified", note: `${cited}:${finding.line} exists` };
  };
}
