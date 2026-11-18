import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import type { KernelEvent, TaskItem } from "../types";
import { IconTrash } from "./Icons";
import { SidePanel } from "./SidePanel";

interface Props {
  onClose: () => void;
  onEvent: (listener: (ev: KernelEvent) => void) => () => void;
}

/** "2026-11-18T17:00" for <input type="datetime-local"> from an ISO time, in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dueLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((day - today) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

function askNotifications() {
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    /* notifications unavailable */
  }
}

/** Tasks and reminders. A task with a due time pops up as a reminder when the time comes. */
export function TasksPanel({ onClose, onEvent }: Props) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    api
      .tasks()
      .then(setTasks)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => onEvent((ev) => ev.type === "reminder.due" && load()), [onEvent, load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (due) askNotifications();
    void act(async () => {
      await api.addTask({ title: t, ...(due ? { due: new Date(due).toISOString() } : {}) });
      setTitle("");
      setDue("");
    });
  };

  const groups = useMemo(() => {
    const open = (tasks ?? []).filter((t) => !t.done);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    return [
      { key: "overdue", label: "Overdue", items: open.filter((t) => t.due && Date.parse(t.due) < now.getTime()) },
      { key: "today", label: "Today", items: open.filter((t) => t.due && Date.parse(t.due) >= now.getTime() && Date.parse(t.due) < endOfToday) },
      { key: "later", label: "Upcoming", items: open.filter((t) => t.due && Date.parse(t.due) >= endOfToday) },
      { key: "someday", label: "No date", items: open.filter((t) => !t.due) },
    ].filter((g) => g.items.length);
  }, [tasks, now]);
  const done = (tasks ?? []).filter((t) => t.done);

  const row = (t: TaskItem) => (
    <li key={t.id} className={`task-row${t.done ? " is-done" : ""}`}>
      <input type="checkbox" checked={t.done} aria-label={`${t.done ? "Reopen" : "Complete"} ${t.title}`} onChange={(e) => void act(() => api.updateTask(t.id, { done: e.target.checked }))} />
      <span className="task-title">{t.title}</span>
      {t.due ? <span className={`task-due${!t.done && Date.parse(t.due) < now.getTime() ? " is-late" : ""}`}>{dueLabel(t.due, now)}</span> : null}
      <label className="sr-only" htmlFor={`due-${t.id}`}>
        Due time for {t.title}
      </label>
      <input
        id={`due-${t.id}`}
        className="task-due-edit"
        type="datetime-local"
        value={toLocalInput(t.due)}
        title="Change the due time"
        onChange={(e) => void act(() => api.updateTask(t.id, { due: e.target.value ? new Date(e.target.value).toISOString() : null }))}
      />
      <button type="button" className="icon-btn" aria-label={`Delete ${t.title}`} title="Delete" onClick={() => void act(() => api.deleteTask(t.id))}>
        <IconTrash size={13} />
      </button>
    </li>
  );

  return (
    <SidePanel title="Tasks" subtitle="To-dos and reminders. The assistant can read and add them too." onClose={onClose} wide>
      <form className="task-add" onSubmit={add}>
        <label className="sr-only" htmlFor="task-title">
          New task
        </label>
        <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" autoComplete="off" />
        <label className="sr-only" htmlFor="task-due">
          Remind me at
        </label>
        <input id="task-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} title="Remind me at (optional)" />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!title.trim()}>
          Add
        </button>
      </form>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {tasks === null && !error ? <p className="muted">Loading…</p> : null}
      {tasks && groups.length === 0 ? <p className="muted">Nothing to do. Add a task above, or ask the assistant to remind you of something.</p> : null}
      {groups.map((g) => (
        <section key={g.key} className={`task-group task-${g.key}`} aria-label={g.label}>
          <h3 className="launch-h">{g.label}</h3>
          <ul className="task-list">{g.items.map(row)}</ul>
        </section>
      ))}
      {done.length ? (
        <section className="task-group" aria-label="Done">
          <button type="button" className="btn btn-sm task-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((x) => !x)}>
            {showDone ? "Hide" : "Show"} done ({done.length})
          </button>
          {showDone ? <ul className="task-list">{done.map(row)}</ul> : null}
        </section>
      ) : null}
    </SidePanel>
  );
}
