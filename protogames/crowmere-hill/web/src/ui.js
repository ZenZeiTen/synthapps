// Sierra-style text UI: status bar, typed input line, modal message boxes, dialogs.

import { SCREEN_W, PIC_Y, PIC_H, INPUT_Y, wrap } from './gfx.js';

const BOX_CHARS = 36;
const PAGE_LINES = 13;

export class UI {
  constructor(font) {
    this.font = font;
    this.queue = [];      // [{lines, title?, onClose?}]
    this.input = '';
    this.dialog = null;   // {title, lines, keys: {k: fn}}
  }

  get modal() { return this.queue.length > 0 || this.dialog !== null; }

  say(text, opts = {}) {
    const lines = [];
    for (const para of String(text).split('\n')) lines.push(...wrap(para, BOX_CHARS));
    for (let i = 0; i < lines.length; i += PAGE_LINES) {
      this.queue.push({ lines: lines.slice(i, i + PAGE_LINES), ...opts, onClose: i + PAGE_LINES >= lines.length ? opts.onClose : null });
    }
  }

  dismiss() {
    if (this.dialog) return false;           // dialogs need an explicit choice
    const m = this.queue.shift();
    if (m && m.onClose) m.onClose();
    return !!m;
  }

  choose(key) {
    if (!this.dialog) return false;
    const fn = this.dialog.keys[key.toLowerCase()];
    if (!fn) return false;
    this.dialog = null;
    fn();
    return true;
  }

  drawBox(screen, lines, color = 15, border = 4, title = null) {
    const f = this.font;
    const tw = Math.max(...lines.map((l) => l.length), title ? title.length : 0) * f.cw;
    const w = tw + 16, h = lines.length * f.ch + 12 + (title ? f.ch + 2 : 0);
    const x = Math.floor((SCREEN_W - w) / 2), y = PIC_Y + Math.max(2, Math.floor((PIC_H - h) / 2));
    screen.rect(x, y, w, h, 0);
    screen.rect(x + 1, y + 1, w - 2, h - 2, color);
    screen.rect(x + 3, y + 3, w - 6, 1, border); screen.rect(x + 3, y + h - 4, w - 6, 1, border);
    screen.rect(x + 3, y + 3, 1, h - 6, border); screen.rect(x + w - 4, y + 3, 1, h - 6, border);
    let ty = y + 7;
    if (title) { f.draw(screen, title, x + Math.floor((w - f.width(title)) / 2), ty, border); ty += f.ch + 2; }
    for (const l of lines) { f.draw(screen, l, x + 8, ty, 0); ty += f.ch; }
  }

  drawStatus(screen, score, max, sound, music) {
    screen.rect(0, 0, SCREEN_W, PIC_Y, 15);
    this.font.draw(screen, ` Score: ${score} of ${max}`, 0, 1, 0);
    const s = `Sound: ${sound ? 'on' : 'off'}  Music: ${music ? 'on' : 'off'} `;
    this.font.draw(screen, s, SCREEN_W - this.font.width(s), 1, 0);
  }

  drawInput(screen, blink) {
    screen.rect(0, PIC_Y + PIC_H, SCREEN_W, 200 - PIC_Y - PIC_H, 0);
    const maxChars = Math.floor(SCREEN_W / this.font.cw) - 3;
    const shown = this.input.length > maxChars ? this.input.slice(-maxChars) : this.input;
    this.font.draw(screen, '>' + shown + (blink ? '_' : ' '), 2, INPUT_Y, 15);
  }

  drawTop(screen) {
    if (this.dialog) this.drawBox(screen, this.dialog.lines, 15, this.dialog.border ?? 4, this.dialog.title);
    else if (this.queue.length) this.drawBox(screen, this.queue[0].lines, 15, this.queue[0].border ?? 4, this.queue[0].title);
  }
}
