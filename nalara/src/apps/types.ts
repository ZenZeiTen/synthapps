/** Built-in app contracts, shared with the web UI (type-only: no runtime imports here). */

export interface TaskItem {
  id: string;
  title: string;
  notes: string;
  /** ISO date-time, or null for no due time. */
  due: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** The reminder for the current due time has been shown. */
  reminded: boolean;
}
