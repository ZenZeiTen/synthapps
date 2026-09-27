import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { BRAND, INTENT_CHIPS } from "../brand";
import type { IntentClassification } from "../types";
import { IconReturn } from "./Icons";

interface Props {
  agentName: (id: string) => string;
  /** Resolves true when the intent was accepted (the bar then clears). */
  onSubmit: (text: string) => Promise<boolean>;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

const words = (s: string) => s.replace(/_/g, " ").toUpperCase();

/** The intent bar at the bottom of the core: a live classification hint while typing, example intents otherwise. */
export function IntentDock({ agentName, onSubmit, busy, disabled, disabledReason }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<IntentClassification | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const input = useRef<HTMLInputElement>(null);

  // Live classification, debounced.
  useEffect(() => {
    const t = text.trim();
    if (t.length < 3) {
      setPreview(null);
      setPreviewState("idle");
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setPreviewState("loading");
      api
        .classifyIntent(t, ctl.signal)
        .then((c) => {
          setPreview(c);
          setPreviewState("idle");
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setPreviewState("error");
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [text]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy || disabled) return;
    if (await onSubmit(t)) setText("");
  };

  const typing = text.trim().length > 0;
  let hint = "";
  if (typing && text.trim().length >= 3) {
    if (preview) {
      hint = [words(preview.intent), ...preview.required_agents.map((a) => agentName(a).toUpperCase()), `${preview.source === "claude" ? "CLAUDE" : "HEURISTIC"} ${Math.round(preview.confidence * 100)}%`].join(" · ");
    } else if (previewState === "loading") hint = "CLASSIFYING...";
    else if (previewState === "error") hint = "PREVIEW UNAVAILABLE";
  }

  return (
    <form className={`dock${disabled ? " is-disabled" : ""}`} onSubmit={submit} aria-label="Intent">
      <div className="dock-bar">
        <span className={`dock-dot${busy ? " is-busy" : ""}`} aria-hidden="true" />
        <label htmlFor="nos-intent" className="sr-only">
          Tell {BRAND} what you intend
        </label>
        <input
          ref={input}
          id="nos-intent"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled && disabledReason ? disabledReason : "Tell the OS what you intend..."}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-describedby="nos-intent-hint"
        />
        <button type="submit" className="dock-submit" disabled={disabled || busy || !typing} aria-label="Submit intent">
          {busy ? "SENDING" : "INTENT"} <IconReturn size={12} />
        </button>
      </div>
      <div className="dock-under">
        <p id="nos-intent-hint" className={`dock-hint${hint ? " on" : ""}`} aria-live="polite">
          {hint ? (
            <>
              <span className="sr-only">Classified as </span>
              {hint}
            </>
          ) : null}
        </p>
        <div className={`dock-chips${typing ? " off" : ""}`} aria-hidden={typing || undefined}>
          {INTENT_CHIPS.map((x) => (
            <button
              key={x}
              type="button"
              className="dock-chip"
              tabIndex={typing ? -1 : 0}
              disabled={disabled || busy}
              onClick={() => {
                setText(x);
                input.current?.focus();
              }}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
