/** File manager contracts, shared with the web UI (type-only: no runtime imports here). */
import type { FileKind } from "../kernel/types";

/** A folder the file manager can browse: the Nalara home folder, or one the user added. */
export interface Place {
  id: string;
  name: string;
  /** Absolute path on this computer. */
  path: string;
  /** The Nalara home folder; it cannot be removed. */
  builtin: boolean;
  /** False when an added folder has been deleted or its drive is not connected. */
  exists: boolean;
}

export interface FileEntry {
  name: string;
  /** Relative to the place, "/" separators. */
  path: string;
  place: string;
  type: "file" | "dir";
  size: number;
  mtimeMs: number;
  hidden: boolean;
  kind?: FileKind;
}

export interface FileListing {
  place: string;
  /** The folder listed, relative to the place ("" is the place itself). */
  path: string;
  /** Its parent folder, or null at the place itself. */
  parent: string | null;
  /** Folders first, then files, by name. */
  entries: FileEntry[];
}

export interface TextFile {
  place: string;
  path: string;
  content: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

export interface TrashItem {
  id: string;
  place: string;
  /** Where it was, relative to its place. */
  path: string;
  type: "file" | "dir";
  size: number;
  trashedAt: string;
}
