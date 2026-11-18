/**
 * veld-highlight.js — Veld Syntax Highlighter
 *
 * Produces HTML-highlighted Veld source for display in the editor.
 * Depends on: escHtml (included), no other dependencies.
 *
 * Usage (browser):
 *   <script src="veld-engine.js"></script>
 *   <script src="veld-highlight.js"></script>
 *   element.innerHTML = VeldHighlight.highlight(src);
 *
 * Usage (module):
 *   const { highlight, escHtml } = require('./veld-highlight');
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.VeldHighlight = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {

function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function highlight(src) {
  const result = [];
  let i = 0;
  while (i < src.length) {
    // Comment
    if (src[i] === '#') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      result.push({ type: 'cmt', text: src.slice(i, j) });
      i = j;
      continue;
    }
    // String
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== q) {
        if (src[j] === '\\') j++;
        j++;
      }
      if (j < src.length) j++;
      result.push({ type: 'str', text: src.slice(i, j) });
      i = j;
      continue;
    }
    // Code
    let j = i;
    while (j < src.length && src[j] !== '#' && src[j] !== '"' && src[j] !== "'") j++;
    if (j > i) { result.push({ type: 'code', text: src.slice(i, j) }); i = j; }
  }

  return result.map(seg => {
    if (seg.type === 'cmt') return `<span style="color:#2a3c55">${escHtml(seg.text)}</span>`;
    if (seg.type === 'str') return `<span style="color:#2eca8b">${escHtml(seg.text)}</span>`;
    let h = escHtml(seg.text);
    h = h.replace(/\b(let|const|fn|return|if|else|while|for|in|match|and|or|not|break|continue|type|import|export|as|struct|module|use|impl|async|await)\b/g,
      '<span style="color:#6c63ff">$1</span>');
    h = h.replace(/\b(true|false)\b/g, '<span style="color:#ff9f43">$1</span>');
    h = h.replace(/\b(nil)\b/g, '<span style="color:#ff6b9d">$1</span>');
    h = h.replace(/\b(print|println|len|range|push|pop|join|split|to_int|to_float|to_str|to_bool|floor|ceil|abs|min|max|sqrt|type_of)\b/g,
      '<span style="color:#00d4ff">$1</span>');
    h = h.replace(/\b(Int|Float|Bool|Str|List|Any)\b/g, '<span style="color:#ff6b9d">$1</span>');
    h = h.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#f5a623">$1</span>');
    return h;
  }).join('');
}

return { highlight, escHtml };

}));
