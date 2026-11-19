/**
 * Saves each finished workspace's report where the user can find it: Markdown files in the Reports folder of the
 * Nalara home. Nalara writes these itself, as the result of the intent the user gave, so they are saved in every
 * tool-policy mode (also readonly, where agents may not write). The agents' scratch copy in .nalara/outputs stays.
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { renderReportMarkdown } from "../agents/commander";
import type { CommanderReport, Workspace } from "../kernel/types";
import { resolveInside } from "../tools/builtin";
import { REPORTS_DIR } from "./reports-dir";

export { REPORTS_DIR };

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-19 0812 Engineering review (ws_4c9b0c96fe).md": sorts by time, safe on Windows, macOS and Linux. */
export function reportFileName(ws: Pick<Workspace, "id" | "label">, at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`;
  // Characters Windows refuses in names, control characters, and trailing dots or spaces.
  const label =
    (ws.label || "Report")
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "")
      .slice(0, 60) || "Report";
  const id = ws.id.replace(/[^A-Za-z0-9_-]/g, "");
  return `${stamp} ${label} (${id}).md`;
}

/** Writes the report and returns its root-relative path ("Reports/…"). Throws if the folder cannot be written. */
export function saveReport(root: string, ws: Workspace, report: CommanderReport, at = new Date()): string {
  const base = realpathSync(root);
  const dir = resolveInside(base, REPORTS_DIR);
  mkdirSync(dir, { recursive: true });
  const rel = `${REPORTS_DIR}/${reportFileName(ws, at)}`;
  const abs = resolveInside(base, rel);
  writeFileSync(abs, renderReportMarkdown(report, ws), "utf8");
  return rel;
}
