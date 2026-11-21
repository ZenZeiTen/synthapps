// Lintas icon set: drawn on a 24 px grid, 1.75 px round strokes. Static geometry only, built with createElementNS.
// Shape mini-language, '|' separated:  path data  |  c:cx,cy,r  |  r:x,y,w,h,rx  |  prefix '*' = filled shape.

const I = {
  puzzle: 'M10 4.5a2 2 0 1 1 4 0V6h4v4h-1.5a2 2 0 1 0 0 4H18v4h-4v-1.5a2 2 0 1 0-4 0V18H6v-4h1.5a2 2 0 1 0 0-4H6V6h4z',
  plug: 'M9 3v5|M15 3v5|M7 8h10v3a5 5 0 0 1-10 0z|M12 16v5',
  back: 'M19 12H5|M12 19l-7-7 7-7',
  forward: 'M5 12h14|M12 5l7 7-7 7',
  reload: 'M20 12a8 8 0 1 1-2.34-5.66|M20 4v5h-5',
  close: 'M6 6l12 12|M18 6L6 18',
  home: 'M4 11l8-7 8 7|M6 9.5V20h12V9.5|M10 20v-5h4v5',
  plus: 'M12 5v14|M5 12h14',
  minus: 'M5 12h14',
  lock: 'r:5,11,14,9,2|M8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'r:5,11,14,9,2|M8 11V8a4 4 0 0 1 7.6-1.7',
  warning: 'M12 4l9 15.5H3z|M12 10v4.5|M12 17.2v.1',
  info: 'c:12,12,9|M12 11v5.5|M12 7.8v.1',
  alert: 'c:12,12,9|M12 7.5v5.5|M12 16.2v.1',
  star: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  starFilled: '*M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z',
  shieldCheck: 'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z|M8.8 12l2.2 2.2 4.2-4.4',
  translate: 'M3.5 6h9.5|M8.2 3.8V6|M11 6c-.8 4-3.3 6.9-7 8.4|M5.8 9.5c1 2.2 2.9 3.9 5.4 4.9|M12.8 20.2l4.1-9.4 4.1 9.4|M14.2 17.2h5.4',
  download: 'M12 4v11|M7 10.5l5 5 5-5|M5 20h14',
  saveOffline: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z|M14 3v5h5|M12 11v6|M9.5 14.6L12 17l2.5-2.4',
  offlineDone: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z|M14 3v5h5|M9 14.5l2.2 2.2 4-4.2',
  panel: 'r:3,4.5,18,15,2.5|M14.5 4.5v15',
  more: '*c:12,5.5,1.4|*c:12,12,1.4|*c:12,18.5,1.4',
  moreH: '*c:5.5,12,1.4|*c:12,12,1.4|*c:18.5,12,1.4',
  search: 'c:11,11,6.5|M20 20l-4.2-4.2',
  globe: 'c:12,12,9|M3 12h18|M12 3c2.9 3 2.9 15 0 18|M12 3c-2.9 3-2.9 15 0 18',
  clock: 'c:12,12,9|M12 7v5.2l3.2 2',
  history: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4 9.4|M4 5v4.4h4.4|M12 8v4.3l2.8 1.7',
  tab: 'r:3,5,18,14,2.5|M3 9.5h18',
  volume: 'M4 9.5v5h3.5l5 4V5.5l-5 4z|M16 8.8a4.6 4.6 0 0 1 0 6.4|M18.6 6.2a8.2 8.2 0 0 1 0 11.6',
  volumeOff: 'M4 9.5v5h3.5l5 4V5.5l-5 4z|M16.5 9.5l4.5 5|M21 9.5l-4.5 5',
  pin: 'M9 4h6l-.8 6 3 3.2H6.8l3-3.2z|M12 13.2V20',
  private: 'M3 10.5h18|M6.2 10.5L7.8 5h8.4l1.6 5.5|c:7.5,15.8,2.6|c:16.5,15.8,2.6|M10.1 15.5c1.2-.8 2.6-.8 3.8 0',
  settings: 'M4 7h9|M19 7h1|c:16,7,2.4|M4 17h1|M11 17h9|c:8,17,2.4',
  print: 'M7 8V4h10v4|r:3.5,8,17,8.5,2|r:7,13.5,10,6.5,1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkDouble: 'M2.5 12.8l4 4L15 8.2|M11.2 15.8l1.2 1.2L21.5 8.2',
  circle: 'c:12,12,7.5',
  circleCheck: 'c:12,12,9|M8 12.3l2.8 2.8 5.2-5.6',
  pencil: 'M4 20l1-4.2L16.6 4.4a2 2 0 0 1 3 3L8.2 19z|M14.6 6.4l3 3',
  folder: 'M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z|M14 3v5h5',
  fileText: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z|M14 3v5h5|M9 13h6|M9 16.8h4',
  trash: 'M4 7h16|M9 7V4h6v3|M6.2 7l.9 13h9.8l.9-13|M10 11v5.5|M14 11v5.5',
  importIn: 'M12 15V4|M7.5 10.5L12 15l4.5-4.5|M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  exportOut: 'M12 15V4|M7.5 8.5L12 4l4.5 4.5|M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  sparkle: 'M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L4 10.5l5.1-1.9z|M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  send: 'M4.5 11.5L20 4l-5.5 16-3.2-6.8z|M11.3 13.2L20 4',
  book: 'M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z|M5 17a3 3 0 0 1 3-3h10.5',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  chart: 'M4 4v16h16|M8.5 16v-4.5|M12.5 16V8|M16.5 16v-6',
  qa: 'r:5,5,14,16,2|M9 5V3.2h6V5|M8.8 13l2.2 2.2 4.2-4.4',
  wand: 'M5 19L15.5 8.5|M13.6 6.6l3.8 3.8|M18.5 3v3.4|M16.8 4.7h3.4|M20 11.5v2.4|M18.8 12.7h2.4|M8 3.6V6|M6.8 4.8h2.4',
  capture: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8|M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8|M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16|M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16|M8 12h8',
  chevDown: 'M6 9.5l6 6 6-6',
  chevUp: 'M6 14.5l6-6 6 6',
  chevRight: 'M9.5 6l6 6-6 6',
  chevLeft: 'M14.5 6l-6 6 6 6',
  external: 'M14 4h6v6|M20 4l-9 9|M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  copy: 'r:8.5,8.5,11.5,11.5,2|M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5',
  copySource: 'M4 7h7|M4 12h7|M4 17h5|M14 12h6|M17 9l3 3-3 3',
  comment: 'M4 5.5h16V16H9.5L5 19.5V16H4z',
  wifi: 'M2.5 9a14.5 14.5 0 0 1 19 0|M5.5 12.6a10 10 0 0 1 13 0|M8.6 16a5.4 5.4 0 0 1 6.8 0|M12 19.4v.1',
  wifiOff: 'M3 3l18 18|M5.5 12.6a10 10 0 0 1 3.9-2.2|M18.5 12.6a10 10 0 0 0-3.4-2|M8.6 16a5.4 5.4 0 0 1 6.8 0|M12 19.4v.1|M2.5 9a14.5 14.5 0 0 1 4-2.6|M21.5 9a14.5 14.5 0 0 0-10-3.7',
  key: 'c:8,15.5,4|M10.9 12.6L19 4.5|M16 7.5l2.8 2.8|M13.5 10l2 2',
  sun: 'c:12,12,4|M12 2.5v2|M12 19.5v2|M2.5 12h2|M19.5 12h2|M5.2 5.2l1.4 1.4|M17.4 17.4l1.4 1.4|M5.2 18.8l1.4-1.4|M17.4 6.6l1.4-1.4',
  moon: 'M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z',
  filter: 'M4 5.5h16l-6.2 7.3V19l-3.6-1.8v-4.4z',
  ban: 'c:12,12,9|M5.7 5.7l12.6 12.6',
  arrowRight: 'M5 12h14|M13.5 6.5L19 12l-5.5 5.5',
  mic: 'r:9,3,6,11,3|M5.5 11a6.5 6.5 0 0 0 13 0|M12 17.5V21',
  mapPin: 'M12 21s7-6.3 7-11.2a7 7 0 0 0-14 0C5 14.7 12 21 12 21z|c:12,9.8,2.5',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.8 2.2H4.2z|M10 20.2a2 2 0 0 0 4 0',
  clipboard: 'r:5,5,14,16,2|M9 5V3.2h6V5',
  undo: 'M5 9.5h9.5a5 5 0 0 1 0 10H9|M8.8 5.6L5 9.5l3.8 3.9',
  calendar: 'r:4,5,16,15.5,2.5|M4 10h16|M8.5 3v4|M15.5 3v4',
  tms: 'r:3,4.5,18,15,2.5|M12 4.5v15|M6 9h3|M6 12.5h3|M15 9h3|M15 12.5h3|M6 16h2',
  text: 'M5 6h14|M5 10h14|M5 14h9|M5 18h6',
  layers: 'M12 3.5l9 4.7-9 4.7-9-4.7z|M3.5 12.6l8.5 4.4 8.5-4.4|M3.5 16.4l8.5 4.4 8.5-4.4',
  words: 'M4 18L8.5 6 13 18|M5.6 14h5.8|c:17.5,14.5,3.2|M20.7 11v7',
  eye: 'M2.5 12s3.6-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.6 6.5-9.5 6.5S2.5 12 2.5 12z|c:12,12,2.8',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  cookie: 'c:12,12,9|M9 9v.1|M14.5 8.5v.1|M9.5 14.5v.1|M15 14v.1|M12 11.5v.1',
  winMin: 'M6 12h12',
  winMax: 'r:6.5,6.5,11,11,1',
  logo: '',
};

const NS = 'http://www.w3.org/2000/svg';
const cache = new Map();

function build(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('ic');
  for (let s of (I[name] || I.circle).split('|')) {
    if (!s) continue;
    const filled = s[0] === '*'; if (filled) s = s.slice(1);
    let el;
    if (s.startsWith('c:')) {
      const [cx, cy, r] = s.slice(2).split(','); el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    } else if (s.startsWith('r:')) {
      const [x, y, w, hh, rx] = s.slice(2).split(','); el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh); el.setAttribute('rx', rx || 0);
    } else { el = document.createElementNS(NS, 'path'); el.setAttribute('d', s); }
    if (filled) { el.setAttribute('fill', 'currentColor'); el.setAttribute('stroke', 'none'); }
    svg.appendChild(el);
  }
  return svg;
}

export function icon(name, size) {
  if (!cache.has(name)) cache.set(name, build(name));
  const el = cache.get(name).cloneNode(true);
  if (size) { el.style.width = size + 'px'; el.style.height = size + 'px'; }
  return el;
}

/** The Lintas mark: two lanes crossing a strait. */
export function logoMark(size = 28) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
  mk('rect', { x: 1, y: 1, width: 30, height: 30, rx: 9, fill: 'var(--accent)' });
  mk('path', { d: 'M7 12.5h10.5c3 0 4.5 1.4 4.5 3.5', fill: 'none', stroke: 'var(--on-accent)', 'stroke-width': 2.6, 'stroke-linecap': 'round' });
  mk('path', { d: 'M25 19.5H14.5c-3 0-4.5-1.4-4.5-3.5', fill: 'none', stroke: 'var(--on-accent)', 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: '.72' });
  mk('path', { d: 'M19.2 9.2l3.3 3.3-3.3 3.3', fill: 'none', stroke: 'var(--on-accent)', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  mk('path', { d: 'M12.8 22.8l-3.3-3.3 3.3-3.3', fill: 'none', stroke: 'var(--on-accent)', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: '.72' });
  return svg;
}

export const STATUS_ICON = { new: 'circle', draft: 'pencil', translated: 'check', reviewed: 'checkDouble', approved: 'circleCheck' };
export const STATUS_LABEL = { new: 'New', draft: 'Draft', translated: 'Translated', reviewed: 'Reviewed', approved: 'Approved' };
export const STATUSES = ['new', 'draft', 'translated', 'reviewed', 'approved'];
