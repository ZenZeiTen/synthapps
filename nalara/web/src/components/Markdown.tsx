import type { ReactNode } from "react";

/**
 * A small, safe Markdown renderer for assistant answers: it builds React elements (never raw HTML), so text from the
 * model or a web page cannot inject markup. Supports paragraphs, headings, lists, block quotes, fenced code, tables,
 * horizontal rules, inline code, bold, italic, and http(s) links.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first (its content is literal), then links, bold, italic, bare URLs.
  const re = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(https?:\/\/[^\s)<>]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2] !== undefined) {
      const url = m[3];
      out.push(
        SAFE_URL.test(url) ? (
          <a key={k} href={url} target="_blank" rel="noopener noreferrer">
            {inline(m[2], k)}
          </a>
        ) : (
          <span key={k}>{m[2]}</span>
        ),
      );
    } else if (m[4]) out.push(<strong key={k}>{inline(m[4].slice(2, -2), k)}</strong>);
    else if (m[5]) out.push(<em key={k}>{inline(m[5].slice(1, -1), k)}</em>);
    else if (m[6]) {
      const url = m[6].replace(/[.,;:!?]+$/, "");
      out.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (url.length < m[6].length) out.push(m[6].slice(url.length));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  const key = () => `b${b++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code.
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key()} className="md-code" data-lang={fence[2] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(4, heading[1].length + 1);
      const k = key();
      const content = inline(heading[2], k);
      blocks.push(level === 2 ? <h3 key={k}>{content}</h3> : level === 3 ? <h4 key={k}>{content}</h4> : <h5 key={k}>{content}</h5>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key()} />);
      i++;
      continue;
    }
    // Table: header row, then a |---| separator.
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const k = key();
      blocks.push(
        <div key={k} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th key={j}>{inline(h, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={key()}>
          <Markdown text={body.join("\n")} />
        </blockquote>,
      );
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && (bullet.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (bullet.test(lines[i])) items.push(lines[i].replace(bullet, ""));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const k = key();
      const lis = items.map((it, j) => {
        const task = /^\[([ xX])\]\s+(.*)$/.exec(it);
        return (
          <li key={j} className={task ? "md-task" : undefined}>
            {task ? <span aria-hidden="true">{task[1] === " " ? "☐ " : "☑ "}</span> : null}
            {inline(task ? task[2] : it, `${k}-${j}`)}
          </li>
        );
      });
      blocks.push(ordered ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*(```|~~~)|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    const k = key();
    blocks.push(<p key={k}>{inline(para.join("\n"), k)}</p>);
  }
  return <div className={`md${className ? ` ${className}` : ""}`}>{blocks}</div>;
}
