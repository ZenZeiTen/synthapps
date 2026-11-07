// Draws translations over the game picture: as boxes covering the original
// text, or as subtitles. Positions are fractions of the game picture (0..1).
import { el } from './common.js';

export class Overlay {
  constructor(stage) {
    this.root = el('div', { class: 'overlay', 'aria-live': 'polite' });
    stage.append(this.root);
    this.mode = 'boxes';
    this.result = null;
    this.rect = null;
  }

  /** Place the overlay on top of the game picture (pixels relative to the stage). */
  place(rect) {
    if (!rect) return;
    const same = this.rect && ['x', 'y', 'width', 'height'].every((k) => Math.abs(this.rect[k] - rect[k]) < 0.5);
    this.rect = rect;
    Object.assign(this.root.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    if (!same) this.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.render();
  }

  show(result) {
    this.result = result;
    this.render();
  }

  clear() {
    this.result = null;
    this.render();
  }

  peek(on) {
    this.root.classList.toggle('peek', !!on);
  }

  render() {
    this.root.replaceChildren();
    const r = this.result;
    if (!r || !r.lines?.length || this.mode === 'off' || !this.rect) return;
    const boxed = this.mode === 'boxes' ? r.lines.filter((l) => l.box) : [];
    const rest = this.mode === 'boxes' ? r.lines.filter((l) => !l.box) : r.lines;
    for (const l of boxed) this.root.append(this.box(l));
    if (rest.length) {
      const order = { dialogue: 0, narration: 1, sign: 2, title: 3, item: 4, menu: 5, ui: 6, other: 7 };
      // Keep subtitles clear of the game's own text: go to the top when the text is low on screen.
      const boxes = r.lines.filter((l) => l.box);
      const low = boxes.length && boxes.reduce((s, l) => s + l.box.y + l.box.h / 2, 0) / boxes.length > 0.5;
      const subs = el('div', { class: `subs${low ? ' top' : ''}` });
      for (const l of rest.slice().sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 4)) {
        subs.append(el('div', { title: l.original }, l.speaker ? el('span', { class: 'sp' }, `${l.speaker}:`) : null, l.speaker ? ' ' : null, l.translation));
      }
      this.root.append(subs);
    }
  }

  box(line) {
    const H = this.rect.height;
    const b = line.box;
    // Small boxes (menu items) may grow a little so the translation fits.
    const pad = 0.004;
    const left = Math.max(0, b.x - pad), top = Math.max(0, b.y - pad);
    const width = Math.min(1 - left, b.w + pad * 2), height = Math.min(1 - top, b.h + pad * 2);
    const node = el('div', { class: `tl-box ${line.kind}`, title: line.original },
      line.speaker && line.kind === 'dialogue' ? el('span', { class: 'sp' }, line.speaker) : null,
      el('span', {}, line.translation));
    Object.assign(node.style, { left: `${left * 100}%`, top: `${top * 100}%`, minWidth: `${width * 100}%`, maxWidth: `${Math.min(1 - left, width * (line.kind === 'dialogue' || line.kind === 'narration' ? 1 : 1.6)) * 100}%`, height: `${height * 100}%` });
    node.style.visibility = 'hidden';
    this.root.append(node);
    fitText(node, Math.max(10, Math.min(30, (height * H) / 2.3)), Math.min(1 - top, height * 2.2) * H);
    node.style.visibility = '';
    return node;
  }
}

/** Shrink the font until the text fits; if it still does not fit at 10 px, let the box grow downward. */
function fitText(node, startPx, maxHeightPx) {
  let size = startPx;
  node.style.fontSize = `${size}px`;
  while (size > 10 && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
    size -= 1;
    node.style.fontSize = `${size}px`;
  }
  if (node.scrollHeight > node.clientHeight + 1) {
    node.style.height = `${Math.min(maxHeightPx, node.scrollHeight + 4)}px`;
  }
}
