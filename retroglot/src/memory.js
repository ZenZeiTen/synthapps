// Translation memory for one game: the glossary, every translated line in the
// order it appeared (the game's "script"), and a cache of whole screens so the
// same screen is never paid for twice.

import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 20000;
const MAX_FRAMES = 3000;

export const LANGUAGE_CODES = {
  english: 'en', japanese: 'ja', chinese: 'zh', 'chinese (simplified)': 'zh-Hans', 'chinese (traditional)': 'zh-Hant',
  korean: 'ko', indonesian: 'id', malay: 'ms', thai: 'th', vietnamese: 'vi', tagalog: 'tl', filipino: 'fil',
  spanish: 'es', portuguese: 'pt', 'brazilian portuguese': 'pt-BR', french: 'fr', german: 'de', italian: 'it',
  dutch: 'nl', russian: 'ru', polish: 'pl', turkish: 'tr', arabic: 'ar', hindi: 'hi', swedish: 'sv', ukrainian: 'uk',
  czech: 'cs', greek: 'el', hebrew: 'he', javanese: 'jv', sundanese: 'su',
};

export function languageCode(name) {
  if (!name) return 'und';
  const k = String(name).trim().toLowerCase();
  if (LANGUAGE_CODES[k]) return LANGUAGE_CODES[k];
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(name).trim())) return String(name).trim();
  return 'und';
}

export class TranslationMemory {
  constructor(file) {
    this.file = file;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new game */ }
    this.glossary = Array.isArray(data.glossary) ? data.glossary : [];
    this.lines = Array.isArray(data.lines) ? data.lines : [];
    this.frames = data.frames && typeof data.frames === 'object' ? data.frames : {};
    this.usage = data.usage || { requests: 0, cachedScreens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, glossary: this.glossary, lines: this.lines, frames: this.frames, usage: this.usage }));
    fs.renameSync(tmp, this.file);
  }

  cachedScreen(hash) {
    const hit = hash && this.frames[hash];
    if (hit) { this.usage.cachedScreens++; return hit.result; }
    return null;
  }

  rememberScreen(hash, result) {
    if (!hash) return;
    this.frames[hash] = { at: Date.now(), result };
    const keys = Object.keys(this.frames);
    if (keys.length > MAX_FRAMES) {
      keys.sort((a, b) => this.frames[a].at - this.frames[b].at);
      for (const k of keys.slice(0, keys.length - MAX_FRAMES)) delete this.frames[k];
    }
  }

  /** Add lines to the script, skipping a line identical to one of the last few (dialogue that stays on screen). */
  addLines(lines, targetLanguage) {
    const recent = this.lines.slice(-12).map((l) => l.original);
    const added = [];
    for (const l of lines) {
      if (!l.original || recent.includes(l.original)) continue;
      const entry = { at: new Date().toISOString(), original: l.original, translation: l.translation, speaker: l.speaker || '', kind: l.kind || 'other', target: targetLanguage };
      this.lines.push(entry);
      recent.push(l.original);
      added.push(entry);
    }
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    return added;
  }

  recentLines(n = 10) {
    return this.lines.filter((l) => l.kind === 'dialogue' || l.kind === 'narration').slice(-n);
  }

  /** Add glossary terms. User entries are never replaced by suggestions. */
  addTerms(terms, origin = 'suggested') {
    let added = 0;
    for (const t of terms || []) {
      const source = String(t.source || '').trim();
      const target = String(t.target || '').trim();
      if (!source || !target || source.length > 80 || target.length > 120) continue;
      const existing = this.glossary.find((g) => g.source === source);
      if (existing) {
        if (origin === 'user' || existing.origin !== 'user') { existing.target = target; existing.note = t.note || existing.note || ''; existing.origin = origin === 'user' ? 'user' : existing.origin; }
        continue;
      }
      if (this.glossary.length >= 500) break;
      this.glossary.push({ source, target, note: String(t.note || '').slice(0, 200), origin });
      added++;
    }
    return added;
  }

  setGlossary(entries) {
    this.glossary = [];
    this.addTerms(entries, 'user');
    // Keep the origin each entry came with when the client sends it back unchanged.
    for (const e of entries || []) {
      const g = this.glossary.find((x) => x.source === String(e.source || '').trim());
      if (g && e.origin === 'suggested') g.origin = 'suggested';
    }
  }

  addUsage(u, costUsd) {
    this.usage.requests++;
    this.usage.inputTokens += u.input_tokens || 0;
    this.usage.outputTokens += u.output_tokens || 0;
    this.usage.cacheReadTokens += u.cache_read_input_tokens || 0;
    this.usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
    this.usage.costUsd = Math.round((this.usage.costUsd + costUsd) * 1e6) / 1e6;
  }

  clearScript() {
    this.lines = [];
    this.frames = {};
  }
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function xml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The script as CSV, TMX 1.4 or plain text. */
export function exportScript(memory, format, { title = 'game', sourceLanguage = 'auto', targetLanguage = 'English' } = {}) {
  const lines = memory.lines;
  if (format === 'csv') {
    const rows = [['time', 'speaker', 'kind', 'original', 'translation']];
    for (const l of lines) rows.push([l.at, l.speaker, l.kind, l.original, l.translation]);
    return { type: 'text/csv; charset=utf-8', ext: 'csv', body: '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n' };
  }
  if (format === 'tmx') {
    const src = languageCode(sourceLanguage);
    const units = [];
    const seen = new Set();
    for (const l of lines) {
      const tgt = languageCode(l.target || targetLanguage);
      const key = `${l.original}\u0000${tgt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      units.push(`    <tu>${l.speaker ? `\n      <prop type="x-speaker">${xml(l.speaker)}</prop>` : ''}\n      <tuv xml:lang="${xml(src)}"><seg>${xml(l.original)}</seg></tuv>\n      <tuv xml:lang="${xml(tgt)}"><seg>${xml(l.translation)}</seg></tuv>\n    </tu>`);
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4">\n  <header creationtool="retroglot" creationtoolversion="0.1.0" segtype="block" o-tmf="retroglot" adminlang="en" srclang="${xml(src)}" datatype="plaintext">\n    <prop type="x-game">${xml(title)}</prop>\n  </header>\n  <body>\n${units.join('\n')}\n  </body>\n</tmx>\n`;
    return { type: 'application/x-tmx+xml; charset=utf-8', ext: 'tmx', body };
  }
  const text = lines.map((l) => `${l.speaker ? `${l.speaker}: ` : ''}${l.translation}\n    (${l.original})`).join('\n\n');
  return { type: 'text/plain; charset=utf-8', ext: 'txt', body: `${title}\n${'='.repeat(String(title).length)}\n\n${text}\n` };
}
