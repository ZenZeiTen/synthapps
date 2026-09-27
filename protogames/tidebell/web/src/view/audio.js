// Sound effects and looping music with the Web Audio API. Browsers only allow sound after
// the first key or button press, so the context starts on the first input.
export class Audio {
  constructor(base = 'content/') {
    this.base = base;
    this.ctx = null;
    this.buf = {};
    this.music = { name: '', src: null, gain: null };
    this.sfxVol = 0.9;
    this.musicVol = 0.7;
    this.pending = '';
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    if (this.pending) {
      const p = this.pending;
      this.pending = '';
      this.play_music(p);
    }
  }

  async load(path) {
    if (path in this.buf) return this.buf[path];
    this.buf[path] = null;
    try {
      const r = await fetch(this.base + path);
      const data = await r.arrayBuffer();
      this.buf[path] = await this.ctx.decodeAudioData(data);
    } catch {
      this.buf[path] = null;
    }
    return this.buf[path];
  }

  async sfx(name) {
    if (!this.ctx || this.sfxVol <= 0) return;
    const b = await this.load(`sfx/${name}.wav`);
    if (!b) return;
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = this.sfxVol * 0.6;
    s.buffer = b;
    s.connect(g).connect(this.ctx.destination);
    s.start();
  }

  async play_music(name) {
    if (!name || name === 'none') name = '';
    if (name === this.music.name) return;
    const old = this.music;
    this.music = { name, src: null, gain: null };
    if (old.gain && this.ctx) {
      old.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
      old.src.stop(this.ctx.currentTime + 0.45);
    }
    if (!name) return;
    if (!this.ctx) {
      this.pending = name;
      return;
    }
    const b = await this.load(`music/${name}.ogg`);
    if (!b || this.music.name !== name) return;
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    s.buffer = b;
    s.loop = !['clear', 'over'].includes(name);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(this.musicVol * 0.5, this.ctx.currentTime + 0.4);
    s.connect(g).connect(this.ctx.destination);
    s.start();
    this.music.src = s;
    this.music.gain = g;
  }

  setVolumes(m, s) {
    this.musicVol = m;
    this.sfxVol = s;
    if (this.music.gain && this.ctx) this.music.gain.gain.value = m * 0.5;
  }
}
