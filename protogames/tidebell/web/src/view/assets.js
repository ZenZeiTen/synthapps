// Loads content/: the manifest, PNG strips and sheets (as images for the 2D layer), the
// backdrops, the painted stills, the glTF mid layers and the sounds.
export class Assets {
  constructor(base = 'content/') {
    this.base = base;
    this.manifest = null;
    this.defs = null;
    this.text = null;
    this.img = {};
    this.levels = {};
    this.routes = {};
  }

  async json(path) {
    const r = await fetch(this.base + path);
    if (!r.ok) throw new Error('missing ' + path);
    return r.json();
  }

  image(path) {
    return new Promise((ok) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => ok(null);
      im.src = this.base + path + '.png';
    });
  }

  async load(progress = () => {}) {
    this.manifest = await this.json('data/manifest.json');
    this.defs = await this.json('data/defs.json');
    this.text = await this.json('data/text.json');
    const jobs = [];
    const want = [];
    for (const name of Object.keys(this.manifest.sprites)) want.push('sprites/' + name);
    for (const t of this.manifest.tiles.themes) want.push('tiles/' + t, `backdrops/${t}_far`, `backdrops/${t}_mid`);
    for (const s of this.manifest.stills) want.push('stills/' + s);
    let done = 0;
    for (const p of want) {
      jobs.push(this.image(p).then((im) => {
        this.img[p] = im;
        done += 1;
        progress(done / want.length);
      }));
    }
    for (const s of this.defs.stages) {
      jobs.push(fetch(`${this.base}levels/${s}.txt`).then((r) => r.text()).then((t) => { this.levels[s] = t; }));
      jobs.push(fetch(`${this.base}routes/${s}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { this.routes[s] = j; }));
    }
    await Promise.all(jobs);
  }

  meta(name) { return this.manifest.sprites[name]; }

  // The frame index for a tag, cycling through its frames by n.
  frame(name, tag, n = 0) {
    const m = this.meta(name);
    if (!m || !(tag in m.tags)) return 0;
    const [a, count] = m.tags[tag];
    return a + (((n % count) + count) % count);
  }

  stageName(i) {
    const id = this.defs.stages[i];
    if (!id) return '-';
    const m = /^name:\s*(.+)$/m.exec(this.levels[id] ?? '');
    return m ? m[1].trim() : id;
  }
}
