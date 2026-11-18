// Pixel-art source for The House on Crowmere Hill. Every character, item, texture
// and the font are defined here as ASCII pixel maps; build_art.mjs sends them
// through the Aseprite MCP. All designs are original to this project.
//
// Palette letters are the 16 EGA colours:
//   K black  b blue  g green  c cyan  r red  m magenta  n brown  w light grey
//   d dark grey  B light blue  G light green  C light cyan  R light red
//   M light magenta  Y yellow  W white     . (or space) = transparent

export const EGA = {
  K: '#000000', b: '#0000AA', g: '#00AA00', c: '#00AAAA', r: '#AA0000', m: '#AA00AA', n: '#AA5500', w: '#AAAAAA',
  d: '#555555', B: '#5555FF', G: '#55FF55', C: '#55FFFF', R: '#FF5555', M: '#FF55FF', Y: '#FFFF55', W: '#FFFFFF',
};
export const EGA_ORDER = 'KbgcrmnwdBGCRMYW';

// ------------------------------------------------------------------ helpers

const W16 = (s) => { if (s.length !== 16) throw new Error(`row width ${s.length}: "${s}"`); return s; };
function mirror(half) {
  return half.map((h) => { if (h.length !== 8) throw new Error(`half width ${h.length}: "${h}"`); return h + [...h].reverse().join(''); });
}
function patch(rows, x, y, block) {
  const out = rows.map((r) => [...r]);
  block.forEach((line, j) => [...line].forEach((ch, i) => { if (ch !== ' ') out[y + j][x + i] = ch; }));
  return out.map((r) => r.join(''));
}
const flipH = (rows) => rows.map((r) => [...r].reverse().join(''));

// deterministic RNG (mulberry32) so textures rebuild byte-identically
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function grid(w, h, fn) {
  const rows = [];
  for (let y = 0; y < h; y++) { let s = ''; for (let x = 0; x < w; x++) s += fn(x, y); rows.push(s); }
  return rows;
}

// ------------------------------------------------------------------ Gus Pickett (16 x 34, feet at 8,33)

const GUS_FRONT_TOP = patch(mirror([
  '......KK', '....KKrr', '...Krrrr', '...KrrrY', '...Krrrr', '..Krrrrr', '..KKKKKK',   // cap, brim
  '...KnnRR', '...KnRRR', '...KRRKR', '...KRRKR', '...KRRRR', '....KRRr', '.....KKR',   // face
  '....KKYY', '...KYYYY', '..KYKYYY', '..KYKYYY', '..KYKYYY', '..KYKYYY', '..KRKYYY',   // slicker, arms
  '...KKYYY', '....KYYY',                                                                 // hem
]), 5, 14, [
  // satchel strap from left shoulder to right hip, bag on the right hip
  'w', ' w', '  w', '   w', '    KKKK', '    KwwK', '    KddK', '    KKKK',
]);
const GUS_BACK_TOP = patch(mirror([
  '......KK', '....KKrr', '...Krrrr', '...Krrrr', '...Krrrr', '...Krrrr', '...KKKKK',   // cap from behind
  '...Knnnn', '...Knnnn', '...Knnnn', '...Knnnn', '...Knnnn', '....Knnn', '......KR',   // hair, neck
  '....KKYY', '...KYYYY', '..KYKYYY', '..KYKYYY', '..KYKYYY', '..KYKYYY', '..KRKYYY',
  '...KKYYY', '....KYYY',
]), 2, 14, [
  // strap over the right shoulder (viewer's right) down to the bag on the left hip
  '       w', '      w', '     w', '    w', 'KKKK', 'KwwK', 'KddK', 'KKKK',
].map((s, i) => (i < 4 ? s : s)));
const GUS_SIDE_TOP = [
  '.....KKKK.......', '....KrrrrKK.....', '...KrrYrrrrK....', '...KrrrrrrrrK...', '...KrrrrrrrrKKK.',
  '...KKKKKKKrrrrrK', '...KnnnnnKKKKKK.', '...KnnnRRRRRK...', '...KnnRRRRKRK...', '...KnnRRRRKRRK..',
  '...KnRRRRRRRK...', '....KRRRRRrK....', '.....KKRRRK.....', '......KRRK......', '.....KYYYYK.....',
  '....KYYYYYYK....', '...KYYYYYYYYK...', '..KdKYYnYYYYK...', '..KdKYYnYYYYK...', '..KdKYYnYYYYK...',
  '..KKKYYnYYYYK...', '....KYYRYYYYK...', '....KYYYYYYYK...',
].map(W16);

const LEGS_FRONT = {
  stand: ['....KbbbbbbK....', '....KbbKKbbK....', '....KbbKKbbK....', '....KbBKKbBK....', '....KbbKKbbK....',
          '....KbbKKbbK....', '....KbbKKbbK....', '...KrrrKKrrrK...', '...KrrrKKrrrK...', '...KrrrKKrrrK...', '...KKKKKKKKKK...'],
  stepL: ['....KbbbbbbK....', '....KbbKKbbK....', '....KbbKKbbK....', '....KbBKKbBK....', '....KbbKKbbK....',
          '....KbbKKrrrK...', '....KbbKKrrrK...', '...KrrrKKrrrK...', '...KrrrKKKKKK...', '...KrrrK........', '...KKKKK........'],
};
LEGS_FRONT.stepR = flipH(LEGS_FRONT.stepL);
const LEGS_SIDE = {
  stand: ['.....KbbbbbK....', '.....KbbbbbK....', '.....KbbbbbK....', '.....KbBbbbK....', '.....KbbbbbK....',
          '.....KbbbbbK....', '.....KbbbbbK....', '.....KrrrrrrK...', '.....KrrrrrrK...', '.....KrrrrrrrK..', '.....KKKKKKKK...'],
  stepA: ['.....KbbbbbK....', '....KbbbbbbbK...', '....KbbbKKbbbK..', '...KbbbK..KbbbK.', '...KbBK....KbbK.',
          '..KbbK.....KbbK.', '..KbbK......KbbK', '.KrrrK......KrrK', '.KrrrK.....KrrrK', 'KrrrrK.....KrrrK', 'KKKKKK.....KKKKK'],
  pass:  ['.....KbbbbbK....', '.....KbbbbbK....', '.....KbbbbbbK...', '.....KbBbbbbK...', '.....KbbbKbbK...',
          '.....KbbbKKrrrK.', '.....KbbbKKrrrK.', '.....KrrrrrKKK..', '.....KrrrrrrK...', '.....KrrrrrrrK..', '.....KKKKKKKK...'],
};
LEGS_SIDE.stepB = LEGS_SIDE.stepA.map((r) => r.replace('KbBK', 'KbbK').replace(/KbbK(\.+)$/, 'KbBK$1'));

const gus = (top, legs) => [...top, ...legs].map(W16);
export const GUS = {
  size: [16, 34], anchor: [8, 33],
  frames: [
    ['down_stand', gus(GUS_FRONT_TOP, LEGS_FRONT.stand)],
    ['down_stepL', gus(GUS_FRONT_TOP, LEGS_FRONT.stepL)],
    ['down_stepR', gus(GUS_FRONT_TOP, LEGS_FRONT.stepR)],
    ['up_stand', gus(GUS_BACK_TOP, LEGS_FRONT.stand)],
    ['up_stepL', gus(GUS_BACK_TOP, LEGS_FRONT.stepL)],
    ['up_stepR', gus(GUS_BACK_TOP, LEGS_FRONT.stepR)],
    ['side_stand', gus(GUS_SIDE_TOP, LEGS_SIDE.stand)],
    ['side_stepA', gus(GUS_SIDE_TOP, LEGS_SIDE.stepA)],
    ['side_pass', gus(GUS_SIDE_TOP, LEGS_SIDE.pass)],
    ['side_stepB', gus(GUS_SIDE_TOP, LEGS_SIDE.stepB)],
  ],
  // walk cycles as indices into frames; left = side frames mirrored at runtime
  anims: {
    down: { stand: 0, walk: [1, 0, 2, 0] },
    up: { stand: 3, walk: [4, 3, 5, 3] },
    side: { stand: 6, walk: [7, 8, 9, 8] },
  },
  tags: [['down', 1, 3], ['up', 4, 6], ['side', 7, 10]],
};

// ------------------------------------------------------------------ Crumpet (16 x 12, feet at 8,11), faces right

const DOG_HEAD_BODY = [
  '..........KK.KK.',
  '.........KnnKnK.',
  '........KwwwwwK.',
  '.......KwwKwWwK.',
  '.KK...KwwwwwwwKK',
  'KwwKKKwwwwwwwwKK',
  '.KwwwwwwwwwwRKK.',
  '..KwdwwdwwwwwK..',
];
const DOG_LEGS = {
  a: ['..KwwwwwwwwwK...', '..KwK.KwKKwK....', '..KwK..KwKwK....', '..KKK..KKKKK....'],
  b: ['..KwwwwwwwwwK...', '...KwKKwK.KwK...', '..KwK..KwK.KwK..', '..KKK..KKK.KKK..'],
};
const DOG_SIT = [
  '................', '..........KK.KK.', '.........KnnKnK.', '........KwwwwwK.', '.......KwwKwWwK.',
  '.......KwwwwwwKK', '..KK...KwwwwwwKK', '.KwwK.KwwwwwwRK.', '..KwwKwwwwwwwK..', '...KwwdwwwKwwK..',
  '...KwwwwwKwwwK..', '...KKKKKKKKKKK..',
];
const DOG_WAG = patch([...DOG_HEAD_BODY, ...DOG_LEGS.a], 0, 3, ['KK', 'KwK', 'KwwK']);
export const CRUMPET = {
  size: [16, 12], anchor: [8, 11],
  frames: [
    ['walk_a', [...DOG_HEAD_BODY, ...DOG_LEGS.a]],
    ['walk_b', [...DOG_HEAD_BODY, ...DOG_LEGS.b]],
    ['sit', DOG_SIT],
    ['wag', DOG_WAG.map((r) => r.slice(0, 16))],
    ['peek', ['................', '................', '................', '................', '................', '................',
              '................', '................', '.....KK.KK......', '....KnnKnnK.....', '....KwKwwKwK....', '....KwwwwwwK....']],
  ],
  anims: { walk: [0, 1], idle: [2, 2, 2, 3], hide: [4] },
  tags: [['walk', 1, 2], ['sit', 3, 4], ['peek', 5, 5]],
};

// ------------------------------------------------------------------ the crow (14 x 12, feet at 7,11), faces left

const CROW_PERCH = [
  '..............', '...KKK........', '..KKKKK.......', '.dKYKKKK......', 'KdKKKKKKK.....', '...KKKdKKKK...',
  '....KKKdKKKKK.', '....KKKKdKKKKK', '.....KKKKKKKK.', '......KKKKK...', '......K..K....', '.....KK.KK....',
];
export const CROW = {
  size: [14, 12], anchor: [7, 11],
  frames: [
    ['perch', CROW_PERCH],
    ['blink', CROW_PERCH.map((r, i) => (i === 3 ? '.dKKKKKK......' : r))],
    ['caw', CROW_PERCH.map((r, i) => (i === 3 ? 'd.KYKKKK......' : i === 4 ? 'dKKKKKKKK.....' : r))],
    ['fly_up', ['..KK......KK..', '..KKK....KKK..', '...KKK..KKK...', '....KKKKKK....', 'dKYKKKKKKK....', 'KdKKKKKKKKK...',
                '...KKKKKKKKK..', '....KKKKKKK...', '.....KKKKK....', '..............', '..............', '..............']],
    ['fly_down', ['..............', '..............', '...KKK........', 'dKYKKKK.......', 'KdKKKKKKK.....', '...KKKKKKKKK..',
                  '..KKKKKKKKKKK.', '.KKK.KKKK.KKK.', 'KK...KKK...KK.', '.....KK.......', '..............', '..............']],
  ],
  anims: { perch: [0, 0, 0, 0, 0, 1], caw: [2], fly: [3, 4] },
  tags: [['perch', 1, 2], ['caw', 3, 3], ['fly', 4, 5]],
};

// ------------------------------------------------------------------ small props (12 x 8 frames, anchored bottom-centre 6,7)

const pad12 = (rows) => {
  const h = 8, out = [];
  for (let i = 0; i < h - rows.length; i++) out.push('............');
  for (const r of rows) { const l = Math.floor((12 - r.length) / 2); out.push('.'.repeat(l) + r + '.'.repeat(12 - l - r.length)); }
  return out;
};
export const ITEMS = {
  size: [12, 8], anchor: [6, 7],
  frames: [
    ['brass_key', pad12(['.KKK.....', 'KY.YKKKKK', 'KYYYYYYYK', '.KKK.KY.K', '......K..'])],
    ['iron_key', pad12(['.KKK.....', 'KW.wKKKKK', 'KwwwwwwwK', '.KKK.Kw.K', '......K..'])],
    ['matches', pad12(['KKKKKKK', 'KRrWrRK', 'KrrrrrK', 'KKKKKKK'])],
    ['whistle', pad12(['KKKKK..', 'KWwwwKK', 'KwwwwwK', '.KKKKK.'])],
    ['candle', pad12(['.Y.', '.K.', 'KWK', 'KWK', 'KWK', 'KwK', 'KKK'])],
    ['candle_lit', pad12(['.Y.', 'YWY', '.K.', 'KWK', 'KWK', 'KwK', 'KKK'])],
    ['biscuits', pad12(['KKKKKKK', 'KYYYYYK', 'KrRRRrK', 'KYYYYYK', 'KYYYYYK', 'KKKKKKK'])],
    ['collar', pad12(['.KKKKK.', 'KrrrrrK', 'Kr...rK', 'KrrYrrK', '.KKYKK.'])],
    ['flame_a', pad12(['.Y.', 'YWY', '.R.'])],
    ['flame_b', pad12(['Y..', '.WY', '.R.'])],
  ],
  tags: [],
};

// portrait eyes (8 x 2): look left / ahead / right. Drawn over the painted face.
export const EYES = {
  size: [8, 2], anchor: [4, 1],
  frames: [
    ['left', ['KW..KW..', '........'].map((r) => r)],
    ['ahead', ['.KW..KW.', '........']],
    ['right', ['..KW..KW', '........']],
  ],
  tags: [['look', 1, 3]],
};

// stew bubbles (12 x 6)
export const BUBBLES = {
  size: [12, 6], anchor: [6, 5],
  frames: [
    ['a', ['............', '............', '...GG.......', '..G..G...G..', '...GG...G.G.', 'gGgggGgGgggg']],
    ['b', ['............', '.....G......', '....G.G.....', '.....G..GG..', '.G.....G..G.', 'ggGgggggGGgg']],
    ['c', ['.......G....', '..G.........', '.G.G....G...', '..G....G.G..', '........G...', 'gggGGgggggGg']],
  ],
  tags: [['bubble', 1, 3]],
};

// ------------------------------------------------------------------ textures for Blender (sources are EGA-exact)

function planks(seed, base, seam, knot, horizontal) {
  const r = rng(seed);
  const joints = [3, 13, 8, 11];
  return grid(16, 16, (x, y) => {
    const [u, v] = horizontal ? [y, x] : [x, y];
    if (u % 4 === 3) return seam;
    if (v === joints[Math.floor(u / 4)]) return seam;
    return r() < 0.06 ? knot : base;
  });
}
function bricks(base, mortar, hi) {
  return grid(16, 16, (x, y) => {
    if (y % 4 === 3) return mortar;
    const off = Math.floor(y / 4) % 2 ? 4 : 0;
    if ((x + off) % 8 === 7) return mortar;
    return (x + off) % 8 === 0 && y % 4 === 0 ? hi : base;
  });
}
function noise(seed, base, pairs) {
  const r = rng(seed);
  return grid(16, 16, () => { let v = r(); for (const [p, c] of pairs) { if (v < p) return c; v -= p; } return base; });
}

// Wide floorboards: two 7px planks per tile, sparse end joints, a grain streak each.
// (The 3px planks of the first build read as brickwork at room scale.)
const floorboards = grid(16, 16, (x, y) => {
  if (x === 7 || x === 15) return 'K';
  if ((x < 7 && y === 5) || (x > 7 && y === 12)) return 'K';
  if ((x === 2 && y >= 8 && y <= 11) || (x === 11 && y >= 1 && y <= 4) || (x === 4 && y >= 14)) return 'd';
  return 'n';
});

export const TEXTURES = {
  wood_floor: floorboards,
  rug_field: grid(16, 16, (x, y) => ((x + y) % 8 === 0 || (x - y + 16) % 8 === 0 ? 'm' : (x % 8 === 4 && y % 8 === 0) ? 'R' : 'r')),
  wood_boards: planks(12, 'n', 'K', 'd', true),
  wood_dark: planks(13, 'd', 'K', 'n', false),
  porch_boards: planks(14, 'd', 'K', 'w', true),
  wallpaper_red: grid(16, 16, (x, y) => ((x + y) % 16 === 7 || (x - y + 32) % 16 === 7 ? 'n' : (x === 7 && y === 15) || (x === 15 && y === 7) ? 'R' : 'r')),
  wallpaper_green: grid(16, 16, (x, y) => (x % 8 === 0 ? 'K' : x % 8 === 4 ? 'd' : (x % 8 === 2 && y % 4 === 1) ? 'G' : 'g')),
  wallpaper_blue: grid(16, 16, (x, y) => {
    const fx = x % 8, fy = y % 8;
    if ((fx === 3 && fy === 2) || (fx === 2 && fy === 3) || (fx === 4 && fy === 3) || (fx === 3 && fy === 4)) return 'c';
    if (fx === 3 && fy === 3) return 'C';
    return (x + y) % 16 === 0 ? 'B' : 'b';
  }),
  wainscot: grid(16, 16, (x, y) => (y === 0 || y === 15 ? 'K' : x % 8 === 0 ? 'K' : x % 8 === 1 ? 'n' : y === 1 ? 'n' : 'd')),
  stone_wall: grid(16, 16, (x, y) => {
    const row = Math.floor(y / 5), off = row % 2 ? 5 : 0;
    if (y % 5 === 4 || (x + off) % 10 === 9) return 'K';
    return ((x + off) % 10 === 0 || y % 5 === 0) && (x + y) % 3 === 0 ? 'w' : 'd';
  }),
  stone_floor: grid(16, 16, (x, y) => (x % 8 === 7 || y % 8 === 7 ? 'K' : (x * 7 + y * 3) % 11 === 0 ? 'w' : 'd')),
  tiles: grid(16, 16, (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 'd' : 'w')),
  brick: bricks('r', 'd', 'R'),
  brick_dark: bricks('n', 'K', 'r'),
  siding: grid(16, 16, (x, y) => (y % 4 === 3 ? 'K' : y % 4 === 0 ? 'w' : 'd')),
  shingles: grid(16, 16, (x, y) => {
    const off = Math.floor(y / 4) % 2 ? 2 : 0;
    return y % 4 === 3 || (x + off) % 4 === 0 && y % 4 === 2 ? 'K' : 'd';
  }),
  grass: grid(16, 16, (x, y) => {
    const tx = (x + (Math.floor(y / 4) % 2) * 2) % 4, ty = y % 4;
    if (tx === 1 && ty === 1) return 'G';
    if (tx === 1 && ty === 2) return 'g';
    return (x * 3 + y * 5) % 7 === 0 ? 'K' : (x + y * 2) % 11 === 0 ? 'n' : 'g';
  }),
  dirt: noise(22, 'n', [[0.2, 'd'], [0.1, 'K']]),
  coal: noise(23, 'K', [[0.22, 'd'], [0.05, 'w']]),
  iron: grid(16, 16, (x, y) => ((x + y) % 7 === 0 ? 'd' : 'K')),
  books: grid(16, 16, (x, y) => {
    const spines = 'rbgnmcwrgbnmwrcb';
    const h = [2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 2, 3, 1, 2];
    if (y >= 8) { const yy = y - 8; if (yy < h[(x + 5) % 16]) return 'K'; return x % 2 === 1 && yy === 7 ? 'K' : spines[(x + 7) % 16]; }
    if (y < h[x]) return 'K';
    return y === 7 ? 'K' : spines[x];
  }),
  rug_red: grid(16, 16, (x, y) => (x === 0 || x === 15 ? 'n' : x === 1 || x === 14 ? 'Y' : (x + y) % 8 === 0 || (x - y + 16) % 8 === 0 ? 'm' : 'r')),
  bedspread: grid(16, 16, (x, y) => ((x % 4 === 0) && (y % 4 === 0) ? 'M' : (x + y) % 4 === 2 ? 'm' : 'M'.toLowerCase() === 'm' ? 'm' : 'm')),
  crate: grid(16, 16, (x, y) => (x === 0 || x === 15 || y === 0 || y === 15 || x === y || x + y === 15 ? 'K' : y % 5 === 2 ? 'n' : 'n')),
  barrel: grid(16, 16, (x, y) => (y === 3 || y === 12 ? 'K' : x % 4 === 0 ? 'K' : 'n')),
  bottles: grid(16, 16, (x, y) => {
    const cx = x % 4, cy = y % 8;
    if (cy === 7) return 'n';
    const col = 'gbgn'[Math.floor(x / 4) % 4];
    if (cy >= 3 && cx >= 1 && cx <= 2) return col;
    if (cy >= 1 && cy < 3 && cx === 1) return col;
    return 'K';
  }),
  window_night: grid(16, 16, (x, y) => (x === 0 || x === 15 || y === 0 || y === 15 || x === 7 || x === 8 || y === 7 ? 'K' : (x + 2 * y) % 13 === 0 ? 'B' : 'b')),
  window_lit: grid(16, 16, (x, y) => (x === 0 || x === 15 || y === 0 || y === 15 || x === 7 || x === 8 || y === 7 ? 'K' : 'Y')),
  stone_grave: noise(24, 'w', [[0.25, 'd']]),
  curtain: grid(16, 16, (x) => (x % 4 === 0 ? 'K' : x % 4 === 1 ? 'r' : x % 4 === 2 ? 'r' : 'm')),
  armor: grid(16, 16, (x, y) => (x % 5 === 0 ? 'd' : (x + y) % 6 === 0 ? 'W' : 'w')),
  cobweb_grey: noise(25, 'd', [[0.2, 'w'], [0.2, 'K']]),
  portrait: [
    'nnnnnnnnnnnnnnnn', 'nKKKKKKKKKKKKKKn', 'nKbbbbbbbbbbbbKn', 'nKbbbbwwwwbbbbKn', 'nKbbbwwwwwwbbbKn', 'nKbbbwRRRRwbbbKn',
    'nKbbbwKRRKwbbbKn', 'nKbbbwRRRRwbbbKn', 'nKbbbbRKKRbbbbKn', 'nKbbbbbRRbbbbbKn', 'nKbbbKKWWKKbbbKn', 'nKbbKKKWWKKKbbKn',
    'nKbKKKKKKKKKKbKn', 'nKbKKKKKKKKKKbKn', 'nKKKKKKKKKKKKKKn', 'nnnnnnnnnnnnnnnn',
  ],
};
// solid EGA colours, for surfaces that are one flat colour
// Named by colour, never by letter: Windows filesystems are case-insensitive, so
// c_b.png and c_B.png would be ONE file (measured: 6 solids were silently clobbered).
export const EGA_NAMES = { K: 'black', b: 'blue', g: 'green', c: 'cyan', r: 'red', m: 'magenta', n: 'brown', w: 'lgray',
  d: 'dgray', B: 'lblue', G: 'lgreen', C: 'lcyan', R: 'lred', M: 'lmagenta', Y: 'yellow', W: 'white' };
for (const ch of EGA_ORDER) TEXTURES['c_' + EGA_NAMES[ch]] = grid(4, 4, () => ch);

// ------------------------------------------------------------------ font: 5x9 glyphs in 6x10 cells, ASCII 32..126

const G = {
  ' ': '', '!': '..#../..#../..#../..#../..#../...../..#..', '"': '.#.#./.#.#.', '#': '.#.#./#####/.#.#./.#.#./#####/.#.#.',
  $: '..#../.####/#.#../.###./..#.#/####./..#..', '%': '##.../##..#/...#./..#../.#.../#..##/...##',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#', "'": '..#../..#../.#...', '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...', '*': '...../..#../#.#.#/.###./#.#.#/..#..', '+': '...../..#../..#../#####/..#../..#..',
  ',': '...../...../...../...../...../..#../..#../.#...', '-': '...../...../...../#####', '.': '...../...../...../...../...../...../..#..',
  '/': '....#/...#./...#./..#../.#.../.#.../#....', 0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.',
  2: '.###./#...#/....#/...#./..#../.#.../#####', 3: '#####/...#./..#../...#./....#/#...#/.###.', 4: '...#./..##./.#.#./#..#./#####/...#./...#.',
  5: '#####/#..../####./....#/....#/#...#/.###.', 6: '..##./.#.../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.', 9: '.###./#...#/#...#/.####/....#/...#./.##..', ':': '...../..#../...../...../...../..#..',
  ';': '...../..#../...../...../...../..#../..#../.#...', '<': '...#./..#../.#.../#..../.#.../..#../...#.', '=': '...../...../#####/...../#####',
  '>': '.#.../..#../...#./....#/...#./..#../.#...', '?': '.###./#...#/....#/...#./..#../...../..#..', '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.', C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '###../#..#./#...#/#...#/#...#/#..#./###..', E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#', I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..', K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/#...#/##..#/#.#.#/#..##/#...#/#...#', O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....', Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..', U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..', W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####', '[': '.###./.#.../.#.../.#.../.#.../.#.../.###.',
  '\\': '#..../.#.../.#.../..#../...#./...#./....#', ']': '.###./...#./...#./...#./...#./...#./.###.', '^': '..#../.#.#./#...#',
  _: '...../...../...../...../...../...../#####', '`': '.#.../..#..',
  a: '...../...../.###./....#/.####/#...#/.####', b: '#..../#..../#.##./##..#/#...#/#...#/####.', c: '...../...../.###./#..../#..../#...#/.###.',
  d: '....#/....#/.##.#/#..##/#...#/#...#/.####', e: '...../...../.###./#...#/#####/#..../.###.', f: '..##./.#..#/.#.../###../.#.../.#.../.#...',
  g: '...../...../.####/#...#/#...#/#...#/.####/....#/.###.', h: '#..../#..../#.##./##..#/#...#/#...#/#...#', i: '..#../...../.##../..#../..#../..#../.###.',
  j: '...#./...../..##./...#./...#./...#./...#./#..#./.##..', k: '#..../#..../#..#./#.#../##.../#.#../#..#.', l: '.##../..#../..#../..#../..#../..#../.###.',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#', n: '...../...../#.##./##..#/#...#/#...#/#...#', o: '...../...../.###./#...#/#...#/#...#/.###.',
  p: '...../...../####./#...#/#...#/#...#/####./#..../#....', q: '...../...../.####/#...#/#...#/#...#/.####/....#/....#',
  r: '...../...../#.##./##..#/#..../#..../#....', s: '...../...../.####/#..../.###./....#/####.', t: '.#.../.#.../###../.#.../.#.../.#..#/..##.',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#', v: '...../...../#...#/#...#/#...#/.#.#./..#..', w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#', y: '...../...../#...#/#...#/#...#/#...#/.####/....#/.###.', z: '...../...../#####/...#./..#../.#.../#####',
  '{': '...#./..#../..#../.#.../..#../..#../...#.', '|': '..#../..#../..#../..#../..#../..#../..#..', '}': '.#.../..#../..#../...#./..#../..#../.#...',
  '~': '...../...../.#.../#.#.#/...#.',
};
export const FONT = { cell: [6, 10], glyph: [5, 9], cols: 16, first: 32, last: 126, glyphs: G };

export function fontSheetPixels() {
  const pts = [];
  for (let code = FONT.first; code <= FONT.last; code++) {
    const ch = String.fromCharCode(code);
    const spec = G[ch];
    if (spec === undefined) throw new Error('font missing glyph ' + JSON.stringify(ch));
    const i = code - FONT.first, cx = (i % FONT.cols) * FONT.cell[0], cy = Math.floor(i / FONT.cols) * FONT.cell[1];
    const rows = spec === '' ? [] : spec.split('/');
    if (rows.length > 9) throw new Error('glyph too tall ' + ch);
    rows.forEach((row, y) => {
      if (row.length !== 5) throw new Error(`glyph ${ch} row ${y} width ${row.length}`);
      [...row].forEach((c, x) => { if (c === '#') pts.push({ x: cx + x, y: cy + y }); });
    });
  }
  return pts;
}

// ------------------------------------------------------------------ validation

export function validateFrames(sprite, name) {
  const [w, h] = sprite.size;
  for (const [fname, rows] of sprite.frames) {
    if (rows.length !== h) throw new Error(`${name}.${fname}: ${rows.length} rows, want ${h}`);
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`${name}.${fname} row ${y}: width ${r.length}, want ${w}: "${r}"`);
      for (const c of r) if (c !== '.' && c !== ' ' && !EGA[c]) throw new Error(`${name}.${fname}: bad colour ${c}`);
    });
  }
}
export const SPRITES = { gus: GUS, crumpet: CRUMPET, crow: CROW, items: ITEMS, eyes: EYES, bubbles: BUBBLES };
