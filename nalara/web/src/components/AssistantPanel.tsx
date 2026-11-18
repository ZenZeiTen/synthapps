import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api";
import { BRAND } from "../brand";
import type { AssistantMessage, AssistantToolUse, Conversation } from "../types";
import { IconCheck, IconAlert, IconReturn, IconStop } from "./Icons";
import { Markdown } from "./Markdown";
import { SidePanel } from "./SidePanel";

interface Props {
  onClose: () => void;
  /** Claude is connected; offline answers only show a file search. */
  online: boolean;
  onOpenSettings: () => void;
  /** A question to send as soon as the panel opens (from the intent bar's ASK button). */
  question?: string | null;
  onQuestionTaken?: () => void;
}

interface Live {
  question: string;
  turns: string[];
  current: string;
  tools: AssistantToolUse[];
}

const TOOL_WORDS: Record<string, string> = {
  "fs.read_file": "Read",
  "fs.list_files": "Listed",
  "fs.search_text": "Searched text",
  "fs.write_file": "Wrote",
  "search.semantic": "Searched files",
  "memory.recall": "Recalled",
  "memory.remember": "Remembered",
  "git.status": "Git status",
  "git.log": "Git log",
  "git.diff": "Git diff",
};

function ToolChips({ tools }: { tools: AssistantToolUse[] }) {
  if (!tools.length) return null;
  return (
    <ul className="as-tools" aria-label="What the assistant did">
      {tools.map((t, i) => (
        <li key={i} className={`as-tool${t.ok === false ? " is-bad" : t.ok ? " is-ok" : " is-run"}`}>
          {t.ok === false ? <IconAlert size={11} /> : t.ok ? <IconCheck size={11} /> : <span className="as-spin" aria-hidden="true" />}
          <span>{TOOL_WORDS[t.tool] ?? t.tool}</span>
          {t.detail ? <code>{t.detail}</code> : null}
        </li>
      ))}
    </ul>
  );
}

function Message({ m }: { m: AssistantMessage }) {
  if (m.role === "user") {
    return (
      <div className="as-msg as-user">
        <p>{m.text}</p>
      </div>
    );
  }
  return (
    <div className={`as-msg as-bot${m.error ? " has-error" : ""}`}>
      <ToolChips tools={m.tools ?? []} />
      {m.text ? <Markdown text={m.text} /> : null}
      {m.error ? (
        <p className="as-error" role="alert">
          {m.error}
        </p>
      ) : null}
      {m.offline ? <p className="as-tag">Offline answer · local file search</p> : null}
    </div>
  );
}

/** Ask Nalara anything: a conversation with Claude, which can use your files, memory and the web. */
export function AssistantPanel({ onClose, online, onOpenSettings, question, onQuestionTaken }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const convRef = useRef(conversationId);
  convRef.current = conversationId;

  const loadConversations = useCallback(() => {
    api
      .conversations()
      .then(setConversations)
      .catch(() => undefined);
  }, []);
  useEffect(loadConversations, [loadConversations]);
  useEffect(() => () => abort.current?.abort(), []);

  // Keep the newest text in view while it streams.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const open = async (id: string | undefined) => {
    if (live) return;
    setError(null);
    setConversationId(id);
    if (!id) {
      setMessages([]);
      input.current?.focus();
      return;
    }
    try {
      setMessages(await api.conversation(id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const send = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || abort.current) return;
      setError(null);
      setText("");
      const ctl = new AbortController();
      abort.current = ctl;
      setLive({ question: q, turns: [], current: "", tools: [] });
      try {
        const answer = await api.ask(q, {
          ...(convRef.current ? { conversationId: convRef.current } : {}),
          signal: ctl.signal,
          onEvent: (ev) => {
            if (ev.type === "start") {
              setConversationId(ev.conversationId);
              convRef.current = ev.conversationId;
              setMessages((prev) => [...prev, ev.userMessage]);
            } else if (ev.type === "delta") setLive((l) => (l ? { ...l, current: l.current + ev.text } : l));
            else if (ev.type === "turn_text") setLive((l) => (l ? { ...l, turns: ev.text.trim() ? [...l.turns, ev.text] : l.turns, current: "" } : l));
            else if (ev.type === "tool") setLive((l) => (l ? { ...l, tools: [...l.tools, { tool: ev.tool, ...(ev.detail ? { detail: ev.detail } : {}) }] } : l));
            else if (ev.type === "tool_result")
              setLive((l) => {
                if (!l) return l;
                const tools = [...l.tools];
                for (let i = tools.length - 1; i >= 0; i--) {
                  if (tools[i].tool === ev.tool && tools[i].ok === undefined) {
                    tools[i] = { ...tools[i], ok: ev.ok };
                    break;
                  }
                }
                return { ...l, tools };
              });
            else if (ev.type === "done") setMessages((prev) => [...prev, ev.message]);
            else if (ev.type === "error") setError(ev.error);
          },
        });
        if (!answer && !ctl.signal.aborted) setError("The answer was cut off. Try again.");
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof ApiError && err.code === "kernel_halted" ? "Nalara is halted. Resume it to ask questions." : (err as Error).message);
          setText((t) => t || q);
        }
      } finally {
        abort.current = null;
        setLive(null);
        loadConversations();
        if (ctl.signal.aborted && convRef.current) api.conversation(convRef.current).then(setMessages).catch(() => undefined);
      }
    },
    [loadConversations],
  );

  // A question handed over from the intent bar.
  useEffect(() => {
    if (question && !abort.current) {
      onQuestionTaken?.();
      void send(question);
    }
  }, [question, onQuestionTaken, send]);

  const remove = async () => {
    if (!conversationId || live) return;
    try {
      await api.deleteConversation(conversationId);
      await open(undefined);
      loadConversations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  };

  const streaming = live !== null;
  return (
    <SidePanel title={`Ask ${BRAND}`} subtitle={online ? "Answers from Claude, with your files, memory and the web" : "Offline: answers come from a search of your files"} onClose={onClose} wide bodyClassName="as-body">
      <div className="as-bar">
        <label className="sr-only" htmlFor="as-history">
          Conversation
        </label>
        <select id="as-history" className="as-history" value={conversationId ?? ""} disabled={streaming} onChange={(e) => void open(e.target.value || undefined)}>
          <option value="">New conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={streaming || !conversationId} onClick={() => void open(undefined)}>
          New
        </button>
        <button type="button" className="btn btn-sm" disabled={streaming || !conversationId} onClick={() => void remove()}>
          Delete
        </button>
      </div>
      {!online ? (
        <div className="as-offline">
          <p>Without Claude, {BRAND} can only search your files. Add a Claude API key for real answers, writing and web search.</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={onOpenSettings}>
            Add Claude key
          </button>
        </div>
      ) : null}
      <div className="as-list" ref={list} aria-live="polite" aria-busy={streaming}>
        {messages.length === 0 && !live ? (
          <div className="as-empty">
            <p>Ask anything. For example:</p>
            <ul>
              {["Summarize the README in three bullet points", "Which files mention the inventory?", "Write a short email asking for a project update"].map((x) => (
                <li key={x}>
                  <button type="button" className="as-suggest" onClick={() => void send(x)}>
                    {x}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {live ? (
          <div className="as-msg as-bot is-live">
            <ToolChips tools={live.tools} />
            {live.turns.length || live.current ? (
              <Markdown text={[...live.turns, live.current].filter(Boolean).join("\n\n")} />
            ) : (
              <p className="as-thinking">Thinking…</p>
            )}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="as-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="as-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="sr-only" htmlFor="as-input">
          Your question
        </label>
        <textarea
          id="as-input"
          ref={input}
          rows={2}
          value={text}
          placeholder={`Ask ${BRAND} anything…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        {streaming ? (
          <button type="button" className="btn btn-sm as-send" onClick={() => abort.current?.abort()}>
            <IconStop size={12} /> Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-sm btn-primary as-send" disabled={!text.trim()}>
            Ask <IconReturn size={12} />
          </button>
        )}
      </form>
    </SidePanel>
  );
}
