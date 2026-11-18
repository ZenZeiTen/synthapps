// Stage files (content/levels/*.txt): a header of `key: value` lines, a `---` line, then
// rows of tiles, 16 px each. Markers become objects and leave an empty tile behind.
// A port of godot/scripts/core/level.gd; the legend is there.
const TILE_CHARS = '#X=H^L~.';
export const ENEMY_MARKERS = { r: 'raider', t: 'thrower', m: 'mudskip', b: 'bat', c: 'crab', g: 'gull', w: 'wisp', o: 'golem' };
export const PICKUP_MARKERS = { $: 'coin', '*': 'gem', k: 'key', T: 'tonic', h: 'heartroot', n: 'knives',
  f: 'feather', q: 'squall', s: 'stoneskin', y: 'fury', 1: 'life' };

// Returns {head, w, h, rows: Array<Uint8Array>, marks: [[char, tx, ty], ...]} (marks row by row).
export function parse(text) {
  const head = {};
  const rows = [];
  let inRows = false;
  for (const line of text.split('\n')) {
    const l = line.replace(/\s+$/, '');
    if (!inRows) {
      if (l === '---') inRows = true;
      else if (l !== '' && !l.startsWith('#')) {
        const i = l.indexOf(':');
        if (i > 0) head[l.substring(0, i).trim()] = l.substring(i + 1).trim();
      }
      continue;
    }
    if (l === '') continue;
    rows.push(l);
  }
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const outRows = [];
  const marks = [];
  for (let ty = 0; ty < rows.length; ty++) {
    const src = rows[ty];
    const b = new Uint8Array(w);
    for (let tx = 0; tx < w; tx++) {
      const c = tx < src.length ? src[tx] : '.';
      if (TILE_CHARS.includes(c)) b[tx] = c.charCodeAt(0);
      else {
        b[tx] = 46;
        marks.push([c, tx, ty]);
      }
    }
    outRows.push(b);
  }
  return { head, w, h: rows.length, rows: outRows, marks };
}

export function list(head, key) {
  if (!(key in head)) return [];
  return String(head[key]).split(',').map((s) => s.trim()).filter((s) => s !== '');
}
