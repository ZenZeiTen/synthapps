// Import parsers and export writers for the file formats linguists and
// localisation engineers use every day. Standard library only.
import zlib from 'node:zlib';
import path from 'node:path';
import { escapeRegex } from './text.js';

// ---------- small helpers ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Linear-time tokenizer for HTML/XML-like markup. Yields text runs and tags;
 * quoted attribute values may contain ">" and comments are skipped whole.
 * Used instead of regular-expression tag stripping, which cannot handle
 * nested or malformed markup reliably.
 */
export function* markupTokens(input) {
  const s = String(input ?? '');
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { yield { type: 'text', value: s.slice(i) }; return; }
    if (lt > i) yield { type: 'text', value: s.slice(i, lt) };
    if (s.startsWith('<!--', lt)) {
      // HTML comments end at "-->" or "--!>"; "<!-->" and "<!--->" close at once.
      if (s.startsWith('<!-->', lt)) { i = lt + 5; continue; }
      if (s.startsWith('<!--->', lt)) { i = lt + 6; continue; }
      const a = s.indexOf('-->', lt + 4), b = s.indexOf('--!>', lt + 4);
      if (a < 0 && b < 0) { i = s.length; continue; }
      i = (b >= 0 && (a < 0 || b < a)) ? b + 4 : a + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      yield { type: 'cdata', value: s.slice(lt + 9, end < 0 ? s.length : end) };
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    const nameMatch = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(s.slice(lt, lt + 80));
    if (!nameMatch && !/^<[!?]/.test(s.slice(lt, lt + 2))) { yield { type: 'text', value: '<' }; i = lt + 1; continue; }
    // Find the closing ">" outside quotes.
    let j = lt + 1, quote = null;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    const raw = s.slice(lt, Math.min(j + 1, s.length));
    i = j + 1;
    if (!nameMatch) continue; // doctype, processing instruction
    yield { type: 'tag', name: nameMatch[2].toLowerCase(), closing: nameMatch[1] === '/', selfClosing: /\/\s*>$/.test(raw), raw };
  }
}

export function tagAttr(raw, name) {
  const re = new RegExp('\\s' + escapeRegex(name) + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = re.exec(raw);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

/** Text content of markup, without any tags. */
export function stripTags(s) {
  let out = '';
  for (const t of markupTokens(s)) if (t.type === 'text' || t.type === 'cdata') out += t.value;
  return decodeEntities(out);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows) {
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text, delim) {
  const t = text.replace(/^\ufeff/, '');
  if (!delim) {
    const first = t.split('\n')[0];
    delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.includes(';') && !first.includes(',') ? ';' : ',');
  }
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// ---------- zip (for .docx) ----------

export function readZip(buf) {
  const files = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid zip-based Office document.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtra;
    const raw = buf.slice(start, start + csize);
    files[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ---------- parsers ----------

export function detectFormat(filename, text = '') {
  const ext = path.extname(filename || '').toLowerCase().replace('.', '');
  const map = { txt: 'txt', text: 'txt', md: 'md', markdown: 'md', html: 'html', htm: 'html', docx: 'docx', srt: 'srt', vtt: 'vtt',
    po: 'po', pot: 'po', xlf: 'xliff', xliff: 'xliff', json: 'json', csv: 'csv', tsv: 'csv', tmx: 'tmx' };
  if (map[ext]) return map[ext];
  if (/^(js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|rb|php|java|kt|swift|go|rs|cs|dart)$/.test(ext)) return 'code';
  if (/^\s*<\?xml[^>]*>\s*<xliff/i.test(text) || /<xliff/i.test(text.slice(0, 500))) return 'xliff';
  if (/<tmx/i.test(text.slice(0, 500))) return 'tmx';
  if (/^\s*<(!doctype html|html)/i.test(text)) return 'html';
  return 'txt';
}

/**
 * Parse a buffer into either { text } (monolingual running text, to be
 * segmented) or { units:[{text,target,key,note}] } (pre-segmented units).
 */
export function parseFile(filename, buf) {
  const format = detectFormat(filename, buf.slice(0, 600).toString('utf8'));
  if (format === 'docx') return { format, text: docxText(buf) };
  const text = decodeText(buf);
  return parseText(format, text, filename);
}

export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.slice(2)); b.swap16(); return b.toString('utf16le'); }
  const s = buf.toString('utf8');
  if (s.includes('\ufffd') && !buf.includes(0xef)) return buf.toString('latin1');
  return s.replace(/^\ufeff/, '');
}

export function parseText(format, text, filename = '') {
  switch (format) {
    case 'html': return { format, ...htmlText(text) };
    case 'md': return { format, text: mdText(text) };
    case 'srt': case 'vtt': return { format, units: subtitleUnits(text) };
    case 'po': return { format, ...poUnits(text) };
    case 'xliff': return { format, ...xliffUnits(text) };
    case 'tmx': return { format, ...tmxUnits(text) };
    case 'json': return { format, units: jsonUnits(text) };
    case 'csv': return { format, ...csvUnits(text) };
    case 'code': return { format, units: codeStrings(text, filename) };
    default: return { format: 'txt', text };
  }
}

export function docxText(buf) {
  const files = readZip(buf);
  if (!files['word/document.xml']) throw new Error('No word/document.xml found; is this a Word document?');
  const xml = files['word/document.xml']().toString('utf8');
  const paras = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0].replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n');
    const t = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|\t|\n/g)].map(x => x[1] !== undefined ? decodeEntities(x[1]) : x[0]).join('');
    paras.push(t);
  }
  return paras.join('\n\n');
}

const SKIP_HTML = new Set(['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form', 'iframe', 'template', 'head', 'select', 'button']);
const BLOCK_HTML = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article', 'main', 'blockquote', 'pre', 'dd', 'dt',
  'figcaption', 'td', 'th', 'table', 'ul', 'ol', 'dl', 'aside', 'caption', 'summary', 'details']);

export function htmlText(html) {
  let title = '', lang = null, inTitle = false, skip = 0;
  const parts = { all: [], main: [] };
  let mainDepth = 0;
  const push = v => { parts.all.push(v); if (mainDepth > 0) parts.main.push(v); };
  for (const t of markupTokens(html)) {
    if (t.type === 'tag') {
      if (t.name === 'html' && !t.closing && !lang) lang = (tagAttr(t.raw, 'lang') || '').toLowerCase().split('-')[0] || null;
      if (t.name === 'title') { inTitle = !t.closing; continue; }
      if (SKIP_HTML.has(t.name) && !t.selfClosing) { skip = Math.max(0, skip + (t.closing ? -1 : 1)); continue; }
      if (skip) continue;
      if (t.name === 'main' || t.name === 'article') mainDepth = Math.max(0, mainDepth + (t.closing ? -1 : 1));
      if (t.name === 'br') push('\n');
      else if (t.name === 'li') { if (!t.closing) push('\n- '); }
      else if (BLOCK_HTML.has(t.name) && t.closing) push('\n\n');
      continue;
    }
    if (inTitle) { title += t.value; continue; }
    if (!skip) push(t.value);
  }
  const tidy = a => decodeEntities(a.join('')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n /g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const main = tidy(parts.main);
  const text = main.length > 400 ? main : tidy(parts.all);
  return { text, title: decodeEntities(title).trim() || null, lang };
}

function mdText(md) {
  return md.replace(/```[\s\S]*?```/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
    .replace(/^>\s?/gm, '');
}

function subtitleUnits(text) {
  const units = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(l => l.trim() && l.trim() !== 'WEBVTT');
    const ti = lines.findIndex(l => l.includes('-->')); // cue timing line, e.g. 00:00:01,000 --> 00:00:02,000
    if (ti < 0) continue;
    const body = stripTags(lines.slice(ti + 1).join(' ')).trim();
    if (body) units.push({ text: body, note: lines[ti].trim(), key: lines[0] && ti > 0 ? lines[0].trim() : null });
  }
  return units;
}

function poString(lines) {
  return lines.map(l => JSON.parse(l.replace(/^[^"]*/, '').replace(/\\(?!["\\nrt])/g, '\\\\'))).join('');
}

function poUnits(text) {
  const units = [];
  let targetLang = (text.match(/"Language:\s*([a-zA-Z_-]+)\\n"/) || [, null])[1];
  if (targetLang) targetLang = targetLang.toLowerCase().split(/[_-]/)[0];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const entry = { comments: [] };
    let cur = null;
    for (const line of lines) {
      if (line.startsWith('#')) { if (/^#[.:]?\s/.test(line)) entry.comments.push(line.replace(/^#[.:]?\s*/, '')); continue; }
      const m = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")$/);
      if (m) { cur = m[1]; entry[cur] = [m[2]]; continue; }
      if (cur && /^\s*"/.test(line)) entry[cur].push(line.trim());
    }
    if (!entry.msgid) continue;
    const src = poString(entry.msgid);
    if (src === '') continue; // header
    const tgt = entry.msgstr ? poString(entry.msgstr) : entry['msgstr[0]'] ? poString(entry['msgstr[0]']) : '';
    units.push({ text: src, target: tgt, key: entry.msgctxt ? poString(entry.msgctxt) : null, note: entry.comments.join(' ') || null });
  }
  return { units, bilingual: true, targetLang };
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : null;
}

function xliffUnits(xml) {
  const head = xml.slice(0, 4000);
  const fileTag = head.match(/<file\b[^>]*>/i)?.[0] || '';
  const rootTag = head.match(/<xliff\b[^>]*>/i)?.[0] || '';
  const lang = (...vals) => (vals.find(Boolean) || '').toLowerCase().split('-')[0] || null;
  const sourceLang = lang(attr(fileTag, 'source-language'), attr(rootTag, 'srcLang'));
  const targetLang = lang(attr(fileTag, 'target-language'), attr(rootTag, 'trgLang'));
  const units = [];
  const unitRe = /<(trans-unit|unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const m of xml.matchAll(unitRe)) {
    const id = attr('<x ' + m[2] + '>', 'id');
    const inner = m[3];
    const src = inner.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const tgt = inner.match(/<target[^>]*>([\s\S]*?)<\/target>/i);
    const note = inner.match(/<note[^>]*>([\s\S]*?)<\/note>/i);
    if (!src) continue;
    units.push({ text: inlineXml(src[1]), target: tgt ? inlineXml(tgt[1]) : '', key: id, note: note ? stripTags(note[1]).trim() : null });
  }
  return { units, bilingual: true, sourceLang, targetLang };
}

// Keep inline tags visible as {1} {/} style markers so tag QA still works.
const PAIRED_INLINE = new Set(['g', 'pc', 'bpt']);
const STANDALONE_INLINE = new Set(['x', 'ph', 'bx', 'ex', 'it', 'sc', 'ec', 'sm', 'em']);
function inlineXml(s) {
  let out = '', inPh = 0;
  for (const t of markupTokens(s)) {
    if (t.type !== 'tag') { if (!inPh) out += t.value; continue; }
    const id = tagAttr(t.raw, 'id');
    if (t.name === 'ph') {
      if (!t.closing) { out += `{${id ?? 'ph'}}`; if (!t.selfClosing) inPh++; } else inPh = Math.max(0, inPh - 1);
    } else if (STANDALONE_INLINE.has(t.name) && !t.closing) out += `{${id ?? t.name}}`;
    else if (PAIRED_INLINE.has(t.name)) out += t.closing ? '{/}' : `{${id ?? t.name}}`;
  }
  return decodeEntities(out).trim();
}

function tmxUnits(xml) {
  const units = [];
  let sourceLang = (attr(xml.match(/<header\b[^>]*>/i)?.[0] || '', 'srclang') || '').toLowerCase().split('-')[0] || null;
  if (sourceLang === '*all*') sourceLang = null;
  let targetLang = null;
  let tuvs = null, cur = null, seg = null;
  for (const t of markupTokens(xml)) {
    if (t.type === 'tag') {
      if (t.name === 'tu') {
        if (!t.closing) tuvs = [];
        else if (tuvs) {
          const s0 = tuvs.find(v => v.lang === sourceLang) || tuvs[0];
          const t0 = tuvs.find(v => v !== s0) || { text: '' };
          if (s0) {
            if (!sourceLang) sourceLang = s0.lang;
            if (!targetLang && t0.lang) targetLang = t0.lang;
            units.push({ text: s0.text, target: t0.text });
          }
          tuvs = null;
        }
      } else if (t.name === 'tuv' && tuvs) {
        if (!t.closing) cur = { lang: (tagAttr(t.raw, 'xml:lang') || tagAttr(t.raw, 'lang') || '').toLowerCase().split('-')[0], text: '' };
        else if (cur) { tuvs.push(cur); cur = null; }
      } else if (t.name === 'seg' && cur) {
        if (!t.closing) seg = ''; else { cur.text = inlineXml(seg); seg = null; }
      } else if (seg != null) seg += t.raw;
    } else if (seg != null) seg += t.type === 'cdata' ? xmlEscape(t.value) : t.value;
  }
  return { units, bilingual: true, sourceLang, targetLang };
}

export function flattenJson(obj, prefix = '', out = []) {
  if (typeof obj === 'string') out.push({ key: prefix, text: obj });
  else if (Array.isArray(obj)) obj.forEach((v, i) => flattenJson(v, prefix ? `${prefix}.${i}` : String(i), out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function jsonUnits(text) {
  let data;
  try { data = JSON.parse(text.replace(/^\ufeff/, '')); } catch (e) { throw new Error('The JSON file could not be read: ' + e.message); }
  return flattenJson(data).map(u => ({ key: u.key, text: u.text }));
}

const LANGISH = /^(source|target|src|tgt|[a-z]{2}(?:[-_][a-z]{2,4})?|english|indonesian|bahasa)$/i;

function csvUnits(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { text: '' };
  const header = rows[0].map(h => h.trim());
  const hasHeader = header.length >= 2 && header.slice(0, 2).every(h => LANGISH.test(h) || /key|id|term|segment/i.test(h));
  const body = hasHeader ? rows.slice(1) : rows;
  const width = Math.max(...body.map(r => r.length));
  if (width < 2) return { units: body.map(r => ({ text: r[0] })) };
  let si = 0, ti = 1, ki = -1;
  if (hasHeader && /^(key|id)$/i.test(header[0]) && header.length >= 3) { ki = 0; si = 1; ti = 2; }
  const code = h => (h && /^[a-z]{2}([-_]|$)/i.test(h) ? h.toLowerCase().slice(0, 2) : null);
  return {
    units: body.map(r => ({ text: (r[si] || '').trim(), target: (r[ti] || '').trim(), key: ki >= 0 ? r[ki] : null })).filter(u => u.text),
    bilingual: true,
    sourceLang: hasHeader ? code(header[si]) : null,
    targetLang: hasHeader ? code(header[ti]) : null,
  };
}

/** Extract user-facing string literals from source code, with line numbers. */
export function codeStrings(text, filename = '') {
  const units = [];
  const lines = text.split('\n');
  const isJsx = /\.(jsx|tsx|vue|svelte|html)$/i.test(filename);
  lines.forEach((line, i) => {
    if (/^\s*(import|export\s+\*|from|#include|using|package)\b/.test(line) || /^\s*(\/\/|#|\*)/.test(line)) return;
    for (const m of line.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const s = m[2];
      if (looksUserFacing(s, line, m.index)) units.push({ text: s, key: `${path.basename(filename) || 'code'}:${i + 1}`, note: line.trim().slice(0, 160) });
    }
    if (isJsx) for (const m of line.matchAll(/>([^<>{}]+)</gu)) {
      const s = m[1].trim();
      if (/\p{L}{2,}/u.test(s)) units.push({ text: s, key: `${path.basename(filename) || 'code'}:${i + 1}`, note: line.trim().slice(0, 160) });
    }
  });
  return units;
}

export function looksUserFacing(s, line = '', index = 0) {
  if (s.length < 2 || !/\p{L}/u.test(s)) return false;
  if (!/\s/.test(s) && !/^[\p{Lu}]\p{Ll}+[.!?:]?$/u.test(s)) return false; // single identifiers, keys, css
  if (/^(https?:|\/|\.\/|#|@|\$|[a-z]+:\/\/)/i.test(s)) return false;
  if (/^[\w.-]+\.(js|ts|css|png|svg|json|html|md)$/i.test(s)) return false;
  if (/^[a-z0-9_.-]+$/.test(s)) return false;
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/.test(s)) return false;
  if (/^[\s\w-]+$/.test(s) && /^(flex|grid|block|none|bold|px|rem|absolute|relative|text-|bg-|p-|m-|w-|h-)/.test(s)) return false;
  const before = line.slice(0, index);
  if (/\b(t|i18n\.t|\$t|gettext|_|__|translate|formatMessage|intl\.formatMessage|useTranslation)\(\s*$/.test(before)) return false;
  if (/\b(require|import|console\.\w+|querySelector(All)?|getElementById|addEventListener|className|class|style|key|id|type|name|href|src|data-[\w-]+)\s*[=:(]\s*\{?\s*$/.test(before)) return false;
  return true;
}

// ---------- exporters ----------

const today = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function exportTbx(entries, { sourceLang = 'id', targetLang = 'en' } = {}) {
  const body = entries.map(e => `      <termEntry id="${xmlEscape(e.id)}">
${e.note ? `        <descrip type="definition">${xmlEscape(e.note)}</descrip>\n` : ''}        <langSet xml:lang="${xmlEscape(e.sourceLang || sourceLang)}">
          <tig><term>${xmlEscape(e.source)}</term><termNote type="administrativeStatus">${status(e.status)}</termNote></tig>
        </langSet>${e.target ? `
        <langSet xml:lang="${xmlEscape(e.targetLang || targetLang)}">
          <tig><term>${xmlEscape(e.target)}</term><termNote type="administrativeStatus">${status(e.status)}</termNote></tig>
        </langSet>` : ''}
      </termEntry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<martif type="TBX-Basic" xml:lang="${xmlEscape(sourceLang)}">
  <martifHeader><fileDesc><sourceDesc><p>Exported from Lintas</p></sourceDesc></fileDesc></martifHeader>
  <text>
    <body>
${body}
    </body>
  </text>
</martif>
`;
}

function status(s) {
  return s === 'approved' ? 'preferredTerm-admn-sts' : s === 'forbidden' ? 'deprecatedTerm-admn-sts' : 'admittedTerm-admn-sts';
}

export function exportTermsCsv(entries) {
  return toCsv([['source', 'target', 'source_lang', 'target_lang', 'status', 'note', 'evidence'],
    ...entries.map(e => [e.source, e.target, e.sourceLang, e.targetLang, e.status, e.note, (e.evidence || []).join(' ')])]);
}

export function exportTmx(pairs, { sourceLang = 'id', targetLang = 'en' } = {}) {
  const tus = pairs.filter(p => p.target).map(p => `    <tu${p.key ? ` tuid="${xmlEscape(p.key)}"` : ''}>
      <tuv xml:lang="${xmlEscape(sourceLang)}"><seg>${xmlEscape(p.text)}</seg></tuv>
      <tuv xml:lang="${xmlEscape(targetLang)}"><seg>${xmlEscape(p.target)}</seg></tuv>
    </tu>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Lintas" creationtoolversion="0.1.0" segtype="sentence" o-tmf="lintas" adminlang="en" srclang="${xmlEscape(sourceLang)}" datatype="plaintext" creationdate="${today()}"/>
  <body>
${tus}
  </body>
</tmx>
`;
}

export function exportSegmentsCsv(segments) {
  return toCsv([['id', 'source', 'key', 'text', 'target', 'note'],
    ...segments.map(s => [s.id, s.srcTitle || '', s.key || '', s.text, s.target || '', s.note || ''])]);
}

function poQuote(s) {
  return '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

export function exportPo(segments, { targetLang = 'en' } = {}) {
  const head = `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: ${targetLang}\\n"\n"X-Generator: Lintas 0.1.0\\n"\n`;
  return head + segments.map(s => `\n#: ${s.id}${s.note ? `\n#. ${s.note.replace(/\n/g, ' ')}` : ''}${s.key ? `\nmsgctxt ${poQuote(s.key)}` : ''}\nmsgid ${poQuote(s.text)}\nmsgstr ${poQuote(s.target || '')}\n`).join('');
}

export function exportXliff(segments, { sourceLang = 'id', targetLang = 'en', original = 'lintas' } = {}) {
  const units = segments.map(s => `      <trans-unit id="${xmlEscape(s.key || s.id)}">
        <source>${xmlEscape(s.text)}</source>
        <target${s.target ? '' : ' state="needs-translation"'}>${xmlEscape(s.target || '')}</target>${s.note ? `\n        <note>${xmlEscape(s.note)}</note>` : ''}
      </trans-unit>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file original="${xmlEscape(original)}" source-language="${xmlEscape(sourceLang)}" target-language="${xmlEscape(targetLang)}" datatype="plaintext">
    <body>
${units}
    </body>
  </file>
</xliff>
`;
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function exportJson(segments, { side = 'target' } = {}) {
  // Null-prototype objects: keys come from imported files and must never reach Object.prototype.
  const out = Object.create(null);
  for (const s of segments) {
    const key = String(s.key || s.id);
    const val = side === 'target' ? (s.target ?? '') : s.text;
    const parts = key.split('.');
    if (parts.some(p => UNSAFE_KEYS.has(p))) { out[key] = val; continue; }
    let node = out, ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (typeof next === 'string') { ok = false; break; }
      node = next ?? (node[parts[i]] = Object.create(null));
    }
    const last = parts[parts.length - 1];
    if (ok && typeof node[last] !== 'object') node[last] = val; else out[key] = val;
  }
  return JSON.stringify(out, null, 2) + '\n';
}
