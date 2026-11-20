/** Terminal and launcher contracts, shared with the web UI (type-only: no runtime imports here). */

export type TerminalEvent =
  | { type: "start"; id: string; cwd: string; shell: string }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  /** `cwd` is the terminal's folder for the next command (changed by `cd`). */
  | { type: "exit"; id: string; exitCode: number | null; signal: string | null; cwd: string; timedOut?: boolean }
  | { type: "error"; error: string; code: string };

/** A program installed on this computer, found in the system's app menus. */
export interface InstalledApp {
  /** Stable id within this computer's scan; launch takes only ids from the list. */
  id: string;
  name: string;
  /** Where it was found, e.g. "Start menu", "/Applications", "applications". */
  source: string;
  /** A short description when the app menu gives one. */
  comment?: string;
}
