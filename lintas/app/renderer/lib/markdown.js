// Small, safe markdown renderer for assistant answers.
// It never produces HTML strings: text is tokenised and emitted as DOM text nodes inside a fixed whitelist of
// elements (p, h3/h4, ul/ol/li, blockquote, pre/code, strong, em, code) plus citation buttons for [n].
// Links are rendered as plain text followed by the URL (no navigation from model output).
import { h } from './dom.js';

function inline(text, onCite) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[(\d{1,3})\])|(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('code', m[1].slice(1, -1)));
    else if (m[2]) out.push(h('strong', inline(m[2].slice(2, -2), onCite)));
    else if (m[3]) out.push(h('em', inline(m[3].slice(1, -1), onCite)));
    else if (m[4]) {
      const n = Number(m[5]);
      out.push(h('button.cite', { type: 'button', title: `Show paragraph ${n} on the page`, 'aria-label': `Citation ${n}`, onClick: () => onCite && onCite(n) }, String(n)));
    } else if (m[6]) out.push(m[7], ' (', m[8], ')');
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src, { onCite } = {}) {
  const root = h('div.md');
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0, para = [];
  const flush = () => { if (para.length) { root.appendChild(h('p', inline(para.join(' '), onCite))); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush(); const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; root.appendChild(h('pre', h('code', buf.join('\n')))); continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); root.appendChild(h(m[1].length <= 2 ? 'h3' : 'h4', inline(m[2], onCite))); i++; continue; }
    if (/^>\s?/.test(line)) {
      flush(); const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      root.appendChild(h('blockquote', inline(buf.join(' '), onCite))); continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      flush(); const ordered = /^\s*\d+[.)]\s+/.test(line); const list = h(ordered ? 'ol' : 'ul');
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) list.appendChild(h('li', inline(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''), onCite)));
      root.appendChild(list); continue;
    }
    para.push(line.trim()); i++;
  }
  flush();
  return root;
}
