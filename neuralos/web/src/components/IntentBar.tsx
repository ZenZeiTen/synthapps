import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { IntentClassification, Workspace } from "../types";

export const INTENT_EXAMPLES = [
  "Review inventory module",
  "Build inventory feature",
  "Localize this website to Indonesian",
  "Translate contract",
];

interface Props {
  agentName: (id: string) => string;
  onGenerated: (ws: Workspace) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function IntentBar({ agentName, onGenerated, onError, disabled }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<IntentClassification | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);

  // Live classification preview, debounced 400 ms.
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
    }, 400);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [text]);

  const submit = async (value: string) => {
    const t = value.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    try {
      const { workspace } = await api.submitIntent(t, true);
      onGenerated(workspace);
      setText("");
    } catch (err) {
      onError(`Intent failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(text);
  };

  return (
    <form className="intent-bar" onSubmit={onSubmit} aria-label="Intent">
      {text.trim().length >= 3 ? (
        <div className="intent-preview" aria-live="polite">
          {previewState === "loading" && !preview ? <span className="muted">Classifying...</span> : null}
          {previewState === "error" ? <span className="muted">Preview unavailable</span> : null}
          {preview ? (
            <>
              <span className="mono intent-class">{preview.intent}</span>
              <span className="intent-agents">
                {preview.required_agents.map((a) => (
                  <span key={a} className="chip chip-agent">
                    <span className="dia" aria-hidden="true" />
                    {agentName(a)}
                  </span>
                ))}
              </span>
              <span className="mono muted intent-conf">
                {preview.source} · {Math.round(preview.confidence * 100)}%
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="intent-row">
        <label htmlFor="nos-intent" className="intent-label">
          Intent
        </label>
        <input
          id="nos-intent"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say what you want done"
          autoComplete="off"
          disabled={disabled}
        />
        <button type="submit" className="btn btn-primary" disabled={disabled || submitting || !text.trim()}>
          {submitting ? "Generating..." : "Generate workspace"}
        </button>
      </div>
      <div className="intent-examples">
        <span className="muted">Try</span>
        {INTENT_EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip-btn" disabled={disabled || submitting} onClick={() => setText(x)}>
            {x}
          </button>
        ))}
      </div>
    </form>
  );
}
