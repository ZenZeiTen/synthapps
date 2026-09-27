import { randomUUID } from "node:crypto";

/** Short random id with a readable prefix, e.g. newId("ws") -> "ws_1a2b3c4d5e". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** "Code Reviewer" -> "code-reviewer" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/** Graph node id for a file path relative to the root. */
export function fileNodeId(relPath: string): string {
  return `file:${relPath.split("\\").join("/")}`;
}
