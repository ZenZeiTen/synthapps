// Sound: PC-speaker style effects (pipeline/audio/make_sfx.py, content/sfx/) and
// looping FM background music (pipeline/audio/make_music.py, content/music/).
// Browsers need a user gesture before audio, so the context is created on the first
// key or click. F2 silences everything; F3 silences just the music.

const SFX_VOLUME = 0.35;
const MUSIC_VOLUME = 0.22;
const FADE_IN = 0.8, FADE_OUT = 0.6;       // seconds

function fromDataUri(uri) {
  const bin = atob(uri.slice(uri.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export class Sound {
  constructor(index, music = null, base = '../content/') {
    this.index = index || {};
    this.music = music;                    // content/music/music.json, or null
    this.base = base;
    this.enabled = true;
    this.musicOn = true;
    this.ctx = null;
    this.buffers = {};
    this.tracks = {};
    this.current = null;                   // track id now playing (or fading in)
    this.voice = null;                     // { src, gain } of the current track
  }

  async load(rel) {
    const b = window.__BUNDLE__ && window.__BUNDLE__[rel];
    // bundled WAVs are decoded in place: an artifact's CSP may refuse fetch() of data: URLs
    const data = b ? fromDataUri(b) : await (await fetch(this.base + rel)).arrayBuffer();
    return this.ctx.decodeAudioData(data);
  }

  async unlock() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { this.ctx = null; return; }
    for (const [name, file] of Object.entries(this.index)) {
      try { this.buffers[name] = await this.load('sfx/' + file); } catch (e) { /* a missing effect is silent, never fatal */ }
    }
    for (const [id, t] of Object.entries((this.music && this.music.tracks) || {})) {
      try { this.tracks[id] = await this.load('music/' + t.file); } catch (e) { /* likewise for music */ }
    }
  }

  play(name) {
    if (!this.enabled || !this.ctx || !this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    const gain = this.ctx.createGain();
    gain.gain.value = SFX_VOLUME;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }

  // Called every tick with the track that should be playing (musicFor() in music.js).
  // Cheap when nothing changes; otherwise fades the old track out and the new one in.
  setMusic(id) {
    if (!this.ctx) return;
    const want = this.enabled && this.musicOn ? id : null;
    if (want === this.current) return;
    if (want && !this.tracks[want]) return;           // still decoding: try next tick
    const now = this.ctx.currentTime;
    if (this.voice) {
      const { src, gain } = this.voice;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE_OUT);
      src.stop(now + FADE_OUT + 0.05);
      this.voice = null;
    }
    this.current = want;
    if (!want) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.tracks[want];
    src.loop = true;                                  // the WAVs are rendered to loop seamlessly
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MUSIC_VOLUME, now + FADE_IN);
    src.connect(gain).connect(this.ctx.destination);
    src.start(now);
    this.voice = { src, gain };
  }

  toggle() { this.enabled = !this.enabled; return this.enabled; }
  toggleMusic() { this.musicOn = !this.musicOn; return this.musicOn; }
}
