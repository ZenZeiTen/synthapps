import { IconClose } from "./Icons";

export interface ClaudeNeeded {
  text: string;
  message: string;
}

interface Props {
  notice: ClaudeNeeded | null;
  busy: boolean;
  onAddKey: () => void;
  onRunOffline: (text: string) => void;
  onDismiss: () => void;
}

/**
 * Shown above the intent bar when an offline Nalara refuses an intent that needs Claude: why, and the two ways on
 * (add a Claude key, or knowingly run the offline file checks).
 */
export function ClaudeNotice({ notice, busy, onAddKey, onRunOffline, onDismiss }: Props) {
  if (!notice) return null;
  return (
    <section className="claude-notice" aria-labelledby="claude-notice-title" role="region">
      <div className="claude-notice-head">
        <h2 id="claude-notice-title" className="claude-notice-title">
          This needs Claude
        </h2>
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onDismiss}>
          <IconClose size={14} />
        </button>
      </div>
      <p className="claude-notice-intent">&ldquo;{notice.text}&rdquo;</p>
      <p className="claude-notice-body">{notice.message}</p>
      <div className="claude-notice-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={onAddKey}>
          Add Claude key
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onRunOffline(notice.text)}>
          Run offline checks anyway
        </button>
      </div>
    </section>
  );
}
