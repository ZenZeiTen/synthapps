// Text basics: normalisation, script and language detection, sentence
// segmentation and tokenisation. No dependencies; uses Intl where it helps.

export const LANG_NAMES = {
  en: 'English', id: 'Indonesian', ms: 'Malay', jv: 'Javanese', su: 'Sundanese',
  nl: 'Dutch', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian',
  tl: 'Tagalog', vi: 'Vietnamese', tr: 'Turkish', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
  th: 'Thai', ar: 'Arabic', hi: 'Hindi', ru: 'Russian', und: 'Unknown',
};

// Short, high-frequency function-word profiles. They are enough to tell the
// common Latin-script languages apart on a sentence or more of text.
export const STOPWORDS = {
  en: 'the of and to a in is it that for on with as was be by this are or at from an not have has but they which you we he she his her their its can will would there been were all one if so no more also than into only other some such these those may should could about our your',
  id: 'yang dan di ke dari ini itu untuk dengan tidak dalam pada adalah akan juga atau ada oleh karena sebagai bisa telah sudah kami kita mereka saya anda dia ia lebih harus dapat seperti para jika agar tersebut antara setelah belum hanya masih sangat secara bagi namun tetapi serta yaitu bahwa saat',
  ms: 'yang dan di ke dari ini itu untuk dengan tidak dalam pada adalah akan juga atau ada oleh kerana sebagai boleh telah sudah kami kita mereka saya anda dia lebih harus dapat seperti jika supaya tersebut antara selepas belum hanya masih sangat secara bagi namun tetapi serta iaitu bahawa semasa',
  jv: 'lan ing kang sing iki iku kanggo karo ora ana saka marang dadi uga utawa wis bisa aku kowe dheweke kula panjenengan menawa nalika',
  nl: 'de het een en van in is dat op te zijn voor met niet aan er als ook maar bij door om dan nog wel naar uit worden wordt deze die heeft hebben',
  de: 'der die das und ist nicht ein eine zu den von mit sich des auf für im dem auch es an als nach wird bei einer um am sind noch wie oder aus werden',
  fr: 'le la les de des du un une et est en que qui dans pour pas sur au avec ce il elle nous vous ils sont par plus ne se mais ou comme leur cette',
  es: 'el la los las de del un una y es en que por para con no se su al lo como más pero sus le ya o este esta son entre cuando muy sin sobre',
  pt: 'o a os as de do da dos das um uma e é em que por para com não se seu sua ao como mais mas ou este esta são entre quando muito sem sobre',
  it: 'il lo la i gli le di del della un una e è in che per con non si suo sua al come più ma o questo questa sono tra quando molto senza',
  tl: 'ang ng sa mga na at ay si ni para kay hindi ito iyon siya ako ikaw kami tayo sila may wala',
  vi: 'và của là có trong được cho không những một các với này đã người để khi từ như cũng',
  tr: 've bir bu da de için ile çok ne ama gibi daha olan var değil kadar sonra en',
};
const STOP = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

export function stopwordsFor(lang) {
  return STOP[lang] || STOP.en;
}

export function normalize(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[​﻿]/g, '')
    .normalize('NFC');
}

const SCRIPTS = [
  ['Han', /\p{Script=Han}/u], ['Hiragana', /\p{Script=Hiragana}/u], ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u], ['Thai', /\p{Script=Thai}/u], ['Arabic', /\p{Script=Arabic}/u],
  ['Devanagari', /\p{Script=Devanagari}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Latin', /\p{Script=Latin}/u],
];

export function scriptCounts(text) {
  const counts = {};
  for (const ch of text.slice(0, 20000)) {
    for (const [name, re] of SCRIPTS) {
      if (re.test(ch)) { counts[name] = (counts[name] || 0) + 1; break; }
    }
  }
  return counts;
}

export function dominantScript(text) {
  const c = scriptCounts(text);
  let best = 'Unknown', n = 0;
  for (const [k, v] of Object.entries(c)) if (v > n) { best = k; n = v; }
  if ((c.Hiragana || 0) + (c.Katakana || 0) > 0 && best === 'Han') return 'Han';
  return best;
}

/** Detect the language of a text. Returns { lang, confidence, script }. */
export function detectLanguage(text) {
  const t = normalize(text);
  const c = scriptCounts(t);
  const script = dominantScript(t);
  const total = Object.values(c).reduce((a, b) => a + b, 0) || 1;
  const kana = (c.Hiragana || 0) + (c.Katakana || 0);
  if (kana / total > 0.05) return { lang: 'ja', confidence: 0.95, script: 'Japanese' };
  const byScript = { Han: 'zh', Hangul: 'ko', Thai: 'th', Arabic: 'ar', Devanagari: 'hi', Cyrillic: 'ru' };
  if (byScript[script]) return { lang: byScript[script], confidence: Math.min(0.99, (c[script] || 0) / total + 0.1), script };
  if (script !== 'Latin') return { lang: 'und', confidence: 0, script };

  const words = (t.toLowerCase().match(/\p{L}+/gu) || []).slice(0, 4000);
  if (words.length === 0) return { lang: 'und', confidence: 0, script };
  const scores = {};
  for (const [lang, set] of Object.entries(STOP)) {
    let hits = 0;
    for (const w of words) if (set.has(w)) hits++;
    scores[lang] = hits / words.length;
  }
  // Malay and Indonesian share most function words; use spelling cues.
  if (scores.id || scores.ms) {
    const idCue = words.filter(w => /^(tidak|sudah|karena|bisa|sangat|saat|bahwa|yaitu|anda|uang|kantor)$/.test(w)).length;
    const msCue = words.filter(w => /^(kerana|boleh|bahawa|iaitu|selepas|semasa|wang|pejabat|tak)$/.test(w)).length;
    if (idCue >= msCue) scores.ms *= 0.8; else scores.id *= 0.8;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, s1] = ranked[0];
  const s2 = ranked[1][1];
  if (s1 < 0.03) return { lang: 'und', confidence: 0, script };
  const margin = s1 === 0 ? 0 : (s1 - s2) / s1;
  const confidence = Math.max(0.05, Math.min(0.99, 0.35 + margin * 0.5 + Math.min(words.length, 60) / 300));
  return { lang: best, confidence: Math.round(confidence * 100) / 100, script };
}

const ABBREV = new Set(('mr mrs ms dr prof sr jr st vs etc e.g i.e no nos fig figs vol pp ed eds approx dept inc ltd co corp ' +
  'jl jln yth bpk ibu sdr tn ny dll dsb dst tsb hlm kab kec prov no. pt cv tbk drs ir h hj').split(' '));

/** Split text into sentences. Paragraph breaks always end a sentence. */
export function splitSentences(text, lang = 'en') {
  const t = normalize(text);
  const out = [];
  if (['zh', 'ja'].includes(lang)) {
    for (const para of t.split(/\n\s*\n|\n/)) {
      const parts = para.match(/[^。！？!?]+[。！？!?]*[」』）)"]?/gu) || [];
      for (const p of parts) if (p.trim()) out.push(p.trim());
    }
    return out;
  }
  for (const para of t.split(/\n\s*\n/)) {
    const lines = para.split('\n');
    // Treat list items and short heading-like lines as their own segments.
    let buf = '';
    const flush = () => { if (buf.trim()) splitPara(buf.trim(), out); buf = ''; };
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      if (/^([-*•]|\d+[.)]|#{1,6})\s/.test(l)) { flush(); buf = l; flush(); continue; }
      buf += (buf ? ' ' : '') + l;
    }
    flush();
  }
  return out;
}

function splitPara(p, out) {
  const re = /([.!?…]+)(["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}\p{Script=Han}])/gu;
  let start = 0, m;
  while ((m = re.exec(p))) {
    const end = m.index + m[1].length + m[2].length;
    const before = p.slice(start, m.index);
    const lastWord = (before.match(/(\S+)$/) || [''])[0].toLowerCase().replace(/^[("'“‘]+/, '');
    if (m[1] === '.' && (ABBREV.has(lastWord) || ABBREV.has(lastWord + '.') || /^\p{L}$/u.test(lastWord) || /^\d+$/.test(lastWord) && /^\d/.test(p.slice(re.lastIndex)))) continue;
    out.push(p.slice(start, end).trim());
    start = re.lastIndex;
  }
  const rest = p.slice(start).trim();
  if (rest) out.push(rest);
}

let wordSeg = null;
function segmenterFor(lang) {
  try {
    if (!wordSeg || wordSeg.lang !== lang) wordSeg = { lang, seg: new Intl.Segmenter(lang === 'und' ? 'en' : lang, { granularity: 'word' }) };
    return wordSeg.seg;
  } catch { return null; }
}

/** Tokenise into word tokens with character offsets. */
export function tokenize(text, lang = 'en') {
  const t = String(text ?? '');
  const tokens = [];
  if (['zh', 'ja', 'th'].includes(lang)) {
    const seg = segmenterFor(lang);
    if (seg) {
      for (const s of seg.segment(t)) if (s.isWordLike) tokens.push({ text: s.segment, start: s.index, end: s.index + s.segment.length });
      return tokens;
    }
  }
  // Words may contain inner hyphens or apostrophes (e.g. "anak-anak", "don't").
  const re = /[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu;
  let m;
  while ((m = re.exec(t))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return tokens;
}

export function words(text, lang = 'en') {
  return tokenize(text, lang).map(t => t.text.toLowerCase());
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
