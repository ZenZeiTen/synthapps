// Scripts that run inside web pages in an isolated JavaScript world: the
// page cannot see or tamper with them, and they cannot see page globals.
export const WORLD_ID = 1999;

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,dd,dt,figcaption,caption,summary,pre';

export const EXTRACT_PARAGRAPHS = `(() => {
  const out = [];
  let n = 0;
  const visible = el => { const r = el.getClientRects(); if (!r.length) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll(${JSON.stringify(BLOCKS)})) {
    if (el.closest('nav,footer,script,style,noscript,[aria-hidden="true"]')) continue;
    if (el.parentElement && el.parentElement.closest(${JSON.stringify(BLOCKS)})) continue;
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (text.length < 2 || !visible(el)) continue;
    n++;
    el.setAttribute('data-lintas-n', String(n));
    out.push({ n, text: text.slice(0, 2000) });
    if (out.length >= 600) break;
  }
  if (!out.length) {
    const t = (document.body ? document.body.innerText : '').trim();
    t.split(/\\n\\s*\\n|\\n/).map(s => s.trim()).filter(Boolean).slice(0, 600).forEach((text, i) => out.push({ n: i + 1, text }));
  }
  return { url: location.href, title: document.title, lang: document.documentElement.lang || null, paragraphs: out };
})()`;

export const PAGE_HTML = `(() => ({ url: location.href, title: document.title, html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : '' }))()`;

export const SELECTION = `(() => String(getSelection() || '').trim())()`;

// Collect translatable text nodes. Originals are kept in this isolated world
// so the page can be restored exactly.
export const COLLECT_TEXT_NODES = `(() => {
  const st = window.__lintas || (window.__lintas = { nodes: [], orig: [] });
  if (st.nodes.length) { st.nodes.forEach((node, i) => { node.nodeValue = st.orig[i]; }); }
  st.nodes = []; st.orig = [];
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','CODE','PRE','KBD','SAMP','SVG','MATH','TEMPLATE','IFRAME','CANVAS']);
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const v = node.nodeValue;
      if (!v || !/\\p{L}{2,}/u.test(v)) return NodeFilter.FILTER_REJECT;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (skip.has(el.tagName) || el.isContentEditable || el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode()) && st.nodes.length < 4000) { st.nodes.push(node); st.orig.push(node.nodeValue); }
  if (document.title) { st.title = document.title; }
  return { count: st.nodes.length, texts: st.orig.map(s => s.slice(0, 1500)), title: document.title, lang: document.documentElement.lang || null };
})()`;

/**
 * Data reaches page scripts only as a base64 literal decoded inside the
 * script, so no translated or page-derived text is ever spliced into code.
 */
function payload(value) {
  const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) throw new Error('Invalid payload encoding.');
  return `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0))))`;
}

export function applyTranslations(pairs, lang) {
  return `(() => {
    const st = window.__lintas; if (!st) return 0;
    const { pairs, lang } = ${payload({ pairs, lang: String(lang || '') })};
    let done = 0;
    for (const [i, t] of pairs) {
      const node = st.nodes[i];
      if (!node || typeof t !== 'string') continue;
      const orig = st.orig[i];
      const lead = orig.match(/^\\s*/)[0], trail = orig.match(/\\s*$/)[0];
      node.nodeValue = lead + t.trim() + trail;
      done++;
    }
    document.documentElement.setAttribute('data-lintas-translated', lang);
    return done;
  })()`;
}

export const RESTORE = `(() => {
  const st = window.__lintas; if (!st) return 0;
  st.nodes.forEach((node, i) => { node.nodeValue = st.orig[i]; });
  if (st.title) document.title = st.title;
  document.documentElement.removeAttribute('data-lintas-translated');
  const n = st.nodes.length; st.nodes = []; st.orig = [];
  return n;
})()`;

export function highlight(n) {
  const num = Number.isInteger(Number(n)) ? Number(n) : 0;
  return `(() => {
    const el = document.querySelector('[data-lintas-n="${num}"]');
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = el.style.outline, prevBg = el.style.backgroundColor, prevT = el.style.transition;
    el.style.transition = 'background-color .6s ease';
    el.style.outline = '3px solid rgba(37, 99, 235, .55)';
    el.style.backgroundColor = 'rgba(250, 204, 21, .28)';
    setTimeout(() => { el.style.outline = prev; el.style.backgroundColor = prevBg; setTimeout(() => { el.style.transition = prevT; }, 700); }, 1800);
    return true;
  })()`;
}
