import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api";
import { IconStop } from "./Icons";
import { SidePanel } from "./SidePanel";

interface Block {
  id: number;
  cwd: string;
  command: string;
  out: { stream: "stdout" | "stderr"; text: string }[];
  exit?: number | null;
  note?: string;
}

/** The session survives closing and reopening the panel (not a page reload). */
const session: { cwd: string | null; blocks: Block[]; next: number } = { cwd: null, blocks: [], next: 1 };
const HISTORY_KEY = "nalara.terminal.history";
const MAX_HISTORY = 200;
const MAX_BLOCKS = 200;

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_HISTORY)));
  } catch {
    /* storage full or blocked: history stays in memory */
  }
}

/** "/home/you/Nalara/src" shown as "~/Nalara/src" style, last parts only. */
function shortCwd(cwd: string, home: string): string {
  const rel = cwd.startsWith(home) ? `Nalara${cwd.slice(home.length)}` : cwd;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : rel || "/";
}

interface Props {
  onClose: () => void;
}

/** A command console on this computer: runs each line in the system shell, streams the output. */
export function TerminalPanel({ onClose }: Props) {
  const [info, setInfo] = useState<{ shell: string; home: string } | null>(null);
  const [cwd, setCwd] = useState<string | null>(session.cwd);
  const [blocks, setBlocks] = useState<Block[]>(session.blocks);
  const [line, setLine] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<string[]>(loadHistory());
  const histPos = useRef<number>(-1);
  const abort = useRef<AbortController | null>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .terminal()
      .then((t) => {
        setInfo(t);
        setCwd((c) => c ?? t.home);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  // Closing the panel stops a command that is still running.
  useEffect(() => () => abort.current?.abort(), []);

  // Keep the session for the next time the panel opens.
  useEffect(() => {
    session.cwd = cwd;
    session.blocks = blocks;
  }, [cwd, blocks]);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const update = (id: number, fn: (b: Block) => Block) => setBlocks((list) => list.map((b) => (b.id === id ? fn(b) : b)));

  const run = async (command: string) => {
    const text = command.trim();
    if (!text) return;
    if (history.current.at(-1) !== text) {
      history.current.push(text);
      saveHistory(history.current);
    }
    histPos.current = -1;
    setLine("");
    setError(null);
    if (/^(clear|cls)$/i.test(text)) {
      setBlocks([]);
      return;
    }
    const id = session.next++;
    const here = cwd ?? info?.home ?? "";
    setBlocks((list) => [...list, { id, cwd: here, command: text, out: [] }].slice(-MAX_BLOCKS));
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await api.run(
        text,
        here || undefined,
        (ev) => {
          if (ev.type === "start") {
            setRunningId(ev.id);
            update(id, (b) => ({ ...b, cwd: ev.cwd }));
          }
          else if (ev.type === "output") update(id, (b) => ({ ...b, out: [...b.out, { stream: ev.stream, text: ev.text }] }));
          else if (ev.type === "exit") {
            update(id, (b) => ({ ...b, exit: ev.exitCode, ...(ev.timedOut ? { note: "stopped after the time limit" } : ev.signal ? { note: `stopped (${ev.signal})` } : {}) }));
            setCwd(ev.cwd);
          } else if (ev.type === "error") update(id, (b) => ({ ...b, exit: null, note: ev.error }));
        },
        ctl.signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") update(id, (b) => ({ ...b, exit: b.exit ?? null, note: b.note ?? "stopped" }));
      else update(id, (b) => ({ ...b, exit: null, note: err instanceof ApiError && err.code === "kernel_halted" ? "Nalara is halted. Resume it to run commands." : (err as Error).message }));
    } finally {
      abort.current = null;
      setRunningId(null);
      inputRef.current?.focus();
    }
  };

  const stop = () => {
    if (runningId) void api.terminalKill(runningId).catch(() => abort.current?.abort());
    else abort.current?.abort();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (runningId) {
        // While a command runs, Enter sends the line to it.
        const text = line;
        setLine("");
        update(blocks.at(-1)?.id ?? -1, (b) => ({ ...b, out: [...b.out, { stream: "stdout", text: `${text}\n` }] }));
        void api.terminalInput(runningId, text).catch((err: Error) => setError(err.message));
      } else void run(line);
    } else if (e.key === "c" && e.ctrlKey && runningId && !window.getSelection()?.toString()) {
      e.preventDefault();
      stop();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setBlocks([]);
    } else if (e.key === "ArrowUp" && history.current.length) {
      e.preventDefault();
      histPos.current = histPos.current < 0 ? history.current.length - 1 : Math.max(0, histPos.current - 1);
      setLine(history.current[histPos.current]);
    } else if (e.key === "ArrowDown" && histPos.current >= 0) {
      e.preventDefault();
      histPos.current += 1;
      if (histPos.current >= history.current.length) {
        histPos.current = -1;
        setLine("");
      } else setLine(history.current[histPos.current]);
    }
  };

  const home = info?.home ?? "";
  const prompt = cwd ? shortCwd(cwd, home) : "…";
  return (
    <SidePanel title="Terminal" subtitle={info ? `${info.shell} on this computer · cd changes folder · Ctrl+C stops · ↑ history` : "Starting…"} onClose={onClose} wide bodyClassName="term-body">
      <div className="term-out" ref={outRef} onMouseUp={() => !window.getSelection()?.toString() && inputRef.current?.focus()} role="log" aria-live="polite" aria-label="Terminal output">
        {blocks.length === 0 ? <p className="term-hint">Type a command, e.g. <code>dir</code> or <code>ls</code>, <code>git status</code>, <code>node --version</code>.</p> : null}
        {blocks.map((b) => (
          <div key={b.id} className="term-block">
            <div className="term-cmd">
              <span className="term-prompt">{shortCwd(b.cwd, home)} ›</span> {b.command}
            </div>
            {b.out.length ? (
              <pre className="term-text">
                {b.out.map((o, i) => (
                  <span key={i} className={o.stream === "stderr" ? "is-err" : undefined}>
                    {o.text}
                  </span>
                ))}
              </pre>
            ) : null}
            {b.exit !== undefined && (b.exit !== 0 || b.note) ? (
              <div className="term-status">
                {b.note ?? `exit code ${b.exit}`}
                {b.note && b.exit !== null && b.exit !== 0 ? ` · exit code ${b.exit}` : ""}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="term-input">
        <label htmlFor="term-line" className="term-prompt">
          {runningId ? "input ›" : `${prompt} ›`}
        </label>
        <input
          id="term-line"
          ref={inputRef}
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder={runningId ? "Send a line to the running command" : "Command"}
        />
        {runningId ? (
          <button type="button" className="btn btn-sm" onClick={stop}>
            <IconStop size={12} /> Stop
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setBlocks([])} disabled={!blocks.length}>
            Clear
          </button>
        )}
      </div>
    </SidePanel>
  );
}
