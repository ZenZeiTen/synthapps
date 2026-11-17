/**
 * The doctor's report: an A4 PDF drawn with vector graphics, so charts
 * stay sharp when printed or zoomed.
 */
import { jsPDF } from 'jspdf';
import { entryContext, entryValue, fmtDate, fmtTime, METRIC_NAME, signed } from './format';
import { EMERGENCY_SIGNS, type Analysis } from './insights';
import { glucoseBands, gradeEntry, hrBands, LEVEL_LABEL, uricBands, type Band } from './ranges';
import { DAY, movingAverage, seriesFor, timeOf, type Point, type Summary } from './stats';
import type { Entry, Level, Metric, Profile, Settings } from './types';
import { decimalsFor, toDisplay, unitFor } from './units';

export interface ReportOptions {
  summary: boolean;
  charts: boolean;
  insights: boolean;
  questions: boolean;
  tests: boolean;
  log: boolean;
}

type RGB = [number, number, number];

const INK: RGB = [20, 35, 60];
const INK2: RGB = [60, 76, 99];
const MUTED: RGB = [102, 118, 138];
const RULE: RGB = [214, 222, 230];
const PAPER: RGB = [241, 245, 243];

const LEVEL_RGB: Record<Level, RGB> = {
  neutral: [107, 122, 140],
  ok: [47, 125, 91],
  low: [47, 109, 181],
  mild: [149, 127, 16],
  watch: [194, 101, 15],
  high: [194, 54, 47],
  urgent: [141, 22, 56]
};

const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** The built-in PDF fonts only cover Windows-1252; swap anything else. */
export function pdfText(s: string): string {
  return s
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x00-\xff]/g, (c) => (WINANSI_EXTRA.has(c) ? c : '?'));
}

const W = 210;
const H = 297;
const M = 16;
const CW = W - 2 * M;

export function buildReport(entries: Entry[], analysis: Analysis, profile: Profile, settings: Settings, opts: ReportOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: 'Health measurements report', subject: 'Blood pressure, heart rate, blood glucose and uric acid', creator: 'Vitalis' });
  let y = M;

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const font = (family: 'helvetica' | 'times', style: 'normal' | 'bold' | 'italic', size: number) => {
    doc.setFont(family, style);
    doc.setFontSize(size);
  };
  const text = (s: string, x: number, yy: number, o?: Parameters<jsPDF['text']>[3]) => doc.text(pdfText(s), x, yy, o);
  const lines = (s: string, width: number): string[] => doc.splitTextToSize(pdfText(s), width) as string[];
  const lh = (size: number) => size * 0.3528 * 1.35;

  const newPage = () => {
    doc.addPage();
    y = M + 6;
  };
  const ensure = (need: number) => {
    if (y + need > H - M - 10) newPage();
  };

  const heading = (title: string, note?: string) => {
    ensure(22);
    y += 4;
    font('times', 'bold', 15);
    color(INK);
    text(title, M, y);
    if (note) {
      font('helvetica', 'normal', 8.5);
      color(MUTED);
      text(note, W - M, y, { align: 'right' });
    }
    y += 2.5;
    stroke(INK);
    doc.setLineWidth(0.4);
    doc.line(M, y, W - M, y);
    y += 6;
  };

  const paragraph = (s: string, size = 9.5, c: RGB = INK2, width = CW, x = M) => {
    font('helvetica', 'normal', size);
    color(c);
    for (const l of lines(s, width)) {
      ensure(lh(size));
      text(l, x, y);
      y += lh(size);
    }
  };

  /* ---------------- Title block ---------------- */
  fill(PAPER);
  doc.rect(0, 0, W, 50, 'F');
  // Rhythm mark
  fill(INK);
  doc.roundedRect(M, 14, 9, 9, 2.4, 2.4, 'F');
  doc.setDrawColor(241, 245, 243);
  doc.setLineWidth(0.6);
  doc.lines([[1.6, 0], [0.7, -1.8], [1, 3.3], [0.8, -2.5], [0.5, 1], [2.3, 0]], M + 1.4, 19.2, [1, 1], 'S', false);
  font('times', 'bold', 11);
  color(INK);
  text('Vitalis', M + 12, 20.3);

  font('times', 'normal', 24);
  text('Health measurements report', M, 35);
  font('helvetica', 'normal', 9.5);
  color(MUTED);
  const periodText = `${fmtDate(analysis.from, true)} to ${fmtDate(analysis.to, true)}`;
  text(`Readings from ${periodText}. Generated ${fmtDate(Date.now(), true)}, ${fmtTime(Date.now())}.`, M, 42);
  y = 60;

  // Patient details in two columns.
  const age = profile.birthYear ? new Date().getFullYear() - profile.birthYear : undefined;
  const conditions = [profile.hasHypertension && 'High blood pressure', profile.hasDiabetes && 'Diabetes', profile.hasGout && 'Gout'].filter(Boolean).join(', ');
  const details: [string, string][] = [
    ['Name', profile.name || 'Not given'],
    ['Age', age ? `${age} (born ${profile.birthYear})` : 'Not given'],
    ['Sex', profile.sex === 'unspecified' ? 'Not given' : profile.sex === 'male' ? 'Male' : 'Female'],
    ['Known conditions', conditions || 'None recorded'],
    ['Medications', profile.medications || 'None recorded'],
    ['Doctor', profile.doctorName || 'Not given']
  ];
  const colW = CW / 2 - 4;
  for (let i = 0; i < details.length; i += 2) {
    let rowH = 0;
    details.slice(i, i + 2).forEach(([k, v], j) => {
      const x = M + j * (CW / 2 + 4);
      font('helvetica', 'normal', 8);
      color(MUTED);
      text(k, x, y);
      font('helvetica', 'bold', 10);
      color(INK);
      const vl = lines(v, colW).slice(0, 3);
      vl.forEach((l, n) => text(l, x, y + 4.6 + n * 4.4));
      rowH = Math.max(rowH, 4.6 + vl.length * 4.4 + 2.5);
    });
    y += rowH;
  }
  y += 2;

  const targets: string[] = [];
  const t = profile.targets;
  if (t.bpSystolicMax || t.bpDiastolicMax) targets.push(`Blood pressure below ${t.bpSystolicMax ?? '-'}/${t.bpDiastolicMax ?? '-'} mmHg`);
  if (t.glucoseFastingMin || t.glucoseFastingMax) targets.push(`Fasting glucose ${t.glucoseFastingMin ?? 80}-${t.glucoseFastingMax ?? 130} mg/dL`);
  if (t.glucoseAfterMealMax) targets.push(`After-meal glucose below ${t.glucoseAfterMealMax} mg/dL`);
  if (t.uricMax) targets.push(`Uric acid below ${t.uricMax} mg/dL`);
  if (targets.length) paragraph(`Personal targets set by a clinician: ${targets.join('; ')}.`, 9, INK2);

  /* ---------------- Summary ---------------- */
  const metrics = analysis.present;
  if (opts.summary) {
    heading('Summary', `${entries.length} readings`);
    if (!metrics.length) paragraph('No readings in this period.');
    const cols = [
      { h: 'Measurement', w: 33 },
      { h: 'Readings', w: 16, right: true },
      { h: 'Average', w: 22, right: true },
      { h: 'Lowest-highest', w: 31, right: true },
      { h: 'In range', w: 16, right: true },
      { h: 'Trend / month', w: 22, right: true },
      { h: 'Latest', w: CW - 140 }
    ];
    if (metrics.length) {
      font('helvetica', 'bold', 7.8);
      color(MUTED);
      let x = M;
      for (const c of cols) {
        text(c.h, c.right ? x + c.w - 2 : x, y, c.right ? { align: 'right' } : undefined);
        x += c.w;
      }
      y += 2;
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.line(M, y, W - M, y);
      y += 5;
    }
    const rowFor = (m: Metric): { s: Summary; d?: Summary } => {
      const S = analysis.summaries;
      if (m === 'bp') return { s: S.systolic, d: S.diastolic };
      return { s: S[m] };
    };
    for (const m of metrics) {
      const { s, d } = rowFor(m);
      const dec = decimalsFor(m, settings);
      const f = (v: number) => toDisplay(m, v, settings).toFixed(dec);
      const unit = unitFor(m, settings);
      const latestEntry = entries.find((e) => e.id === s.latest?.entryId);
      // Heart rate can come from a blood pressure reading's pulse, so grade the point itself.
      const g = m === 'hr' && s.latest
        ? { level: s.latest.level, label: LEVEL_LABEL[s.latest.level] }
        : latestEntry ? gradeEntry(latestEntry, profile) : undefined;
      const latestText = m === 'hr' && s.latest ? `${Math.round(s.latest.v)} bpm` : latestEntry ? entryValue(latestEntry, settings) : '';
      const cells = [
        `${METRIC_NAME[m]}\n${unit}`,
        String(s.count),
        m === 'bp' ? `${Math.round(s.mean)}/${Math.round(d?.mean ?? 0)}` : f(s.mean),
        m === 'bp' ? `${s.min}-${s.max} / ${d?.min}-${d?.max}` : `${f(s.min)}-${f(s.max)}`,
        Number.isNaN(s.inRange) ? '-' : `${Math.round(s.inRange * 100)}%`,
        s.trend30 === null ? 'Too few' : signed(m === 'bp' || m === 'hr' ? s.trend30 : toDisplay(m, s.trend30, settings), m === 'bp' || m === 'hr' ? 0 : dec),
        latestText ? `${latestText}, ${g?.label ?? ''}` : '-'
      ];
      ensure(12);
      let x = M;
      cells.forEach((c, i) => {
        const col = cols[i];
        const [first, second] = c.split('\n');
        font('helvetica', i === 0 || i === 2 ? 'bold' : 'normal', 9.5);
        color(INK);
        if (i === 6 && g) {
          fill(LEVEL_RGB[g.level]);
          doc.circle(x + 1.2, y - 1.1, 1.1, 'F');
          font('helvetica', 'normal', 9);
          const ll = lines(c, col.w - 4).slice(0, 2);
          ll.forEach((l, j) => text(l, x + 4, y + j * 3.8));
        } else {
          text(first, col.right ? x + col.w - 2 : x, y, col.right ? { align: 'right' } : undefined);
        }
        if (second) {
          font('helvetica', 'normal', 7.5);
          color(MUTED);
          text(second, x, y + 3.8);
        }
        x += col.w;
      });
      y += 8.5;
      stroke(RULE);
      doc.setLineWidth(0.15);
      doc.line(M, y - 3, W - M, y - 3);
      y += 2;
    }
    if (metrics.includes('bp') || metrics.includes('hr')) {
      font('helvetica', 'italic', 8);
      color(MUTED);
      ensure(5);
      text('Blood pressure trend is systolic. Heart rate includes the pulse recorded with blood pressure readings.', M, y);
      y += 4;
    }
  }

  /* ---------------- Charts ---------------- */
  if (opts.charts && metrics.length) {
    heading('Trends', 'Dots are readings, coloured by category; the line is the 7-day average');
    for (const m of metrics) {
      drawChart(doc, m, entries, analysis.from, analysis.to, profile, settings, () => y, (v) => (y = v), ensure);
    }
  }

  /* ---------------- Findings ---------------- */
  if (opts.insights) {
    heading('Findings');
    for (const i of analysis.insights) {
      font('helvetica', 'bold', 10);
      const tl = lines(i.title, CW - 8);
      font('helvetica', 'normal', 9);
      const bl = lines(i.body, CW - 8);
      const need = tl.length * lh(10) + bl.length * lh(9) + 4;
      ensure(need);
      const top = y;
      fill(LEVEL_RGB[i.level]);
      doc.roundedRect(M, top - 3.4, 1.3, need - 2.5, 0.6, 0.6, 'F');
      font('helvetica', 'bold', 10);
      color(INK);
      tl.forEach((l) => {
        text(l, M + 5, y);
        y += lh(10);
      });
      font('helvetica', 'normal', 9);
      color(INK2);
      bl.forEach((l) => {
        text(l, M + 5, y);
        y += lh(9);
      });
      y += 3;
    }
  }

  /* ---------------- Questions ---------------- */
  const chosenQuestions = [...settings.customQuestions, ...analysis.questions.map((q) => q.text).filter((q) => !settings.excludedQuestions.includes(q))];
  if (opts.questions && chosenQuestions.length) {
    heading('Questions to discuss', 'Space for the answers');
    chosenQuestions.forEach((q, n) => {
      font('helvetica', 'normal', 9.8);
      const ql = lines(q, CW - 9);
      ensure(ql.length * lh(9.8) + 9);
      font('helvetica', 'bold', 9.8);
      color(MUTED);
      text(`${n + 1}.`, M, y);
      font('helvetica', 'normal', 9.8);
      color(INK);
      ql.forEach((l) => {
        text(l, M + 7, y);
        y += lh(9.8);
      });
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([0.8, 1.2], 0);
      doc.line(M + 7, y + 3, W - M, y + 3);
      doc.setLineDashPattern([], 0);
      y += 7;
    });
  }

  /* ---------------- Tests and doctors ---------------- */
  if (opts.tests && metrics.length) {
    const labs = analysis.labs;
    heading('Tests to ask about', 'Bold = raised by these readings');
    for (const l of labs) {
      font('helvetica', l.suggested ? 'bold' : 'normal', 9.5);
      const nl = lines(l.name, 62);
      font('helvetica', 'normal', 8.8);
      const wl = lines(l.why, CW - 68);
      const need = Math.max(nl.length * lh(9.5), wl.length * lh(8.8)) + 2.5;
      ensure(need);
      font('helvetica', l.suggested ? 'bold' : 'normal', 9.5);
      color(l.suggested ? INK : INK2);
      nl.forEach((s, j) => text(s, M, y + j * lh(9.5)));
      font('helvetica', 'normal', 8.8);
      color(INK2);
      wl.forEach((s, j) => text(s, M + 68, y + j * lh(8.8)));
      y += need;
    }
    heading('Who to see');
    for (const s of analysis.specialists) {
      font('helvetica', 'normal', 8.8);
      const wl = lines(s.when, CW - 68);
      const need = wl.length * lh(8.8) + 2.5;
      ensure(need);
      font('helvetica', s.suggested ? 'bold' : 'normal', 9.5);
      color(s.suggested ? INK : INK2);
      lines(s.who + (s.suggested ? ' (suggested)' : ''), 62).forEach((l, j) => text(l, M, y + j * lh(9.5)));
      font('helvetica', 'normal', 8.8);
      color(INK2);
      wl.forEach((l, j) => text(l, M + 68, y + j * lh(8.8)));
      y += need;
    }
    ensure(30);
    y += 3;
    font('helvetica', 'bold', 9.5);
    color(LEVEL_RGB.urgent);
    text('Get urgent care for:', M, y);
    y += lh(9.5) + 0.5;
    for (const s of EMERGENCY_SIGNS) {
      font('helvetica', 'normal', 8.8);
      const sl = lines(s, CW - 5);
      ensure(sl.length * lh(8.8));
      color(INK2);
      text('-', M, y);
      sl.forEach((l) => {
        text(l, M + 4, y);
        y += lh(8.8);
      });
    }
  }

  /* ---------------- Log ---------------- */
  if (opts.log && entries.length) {
    newPage();
    heading('All readings', `${entries.length} in this period, oldest first`);
    const cols = [
      { h: 'Date', w: 22 },
      { h: 'Time', w: 12 },
      { h: 'Measurement', w: 28 },
      { h: 'Value', w: 20, right: true },
      { h: 'Unit', w: 15 },
      { h: 'Category', w: 30 },
      { h: 'Context, tags and notes', w: CW - 127 }
    ];
    const head = () => {
      font('helvetica', 'bold', 7.8);
      color(MUTED);
      let x = M;
      for (const c of cols) {
        text(c.h, c.right ? x + c.w - 3 : x, y, c.right ? { align: 'right' } : undefined);
        x += c.w;
      }
      y += 1.8;
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.line(M, y, W - M, y);
      y += 4.4;
    };
    head();
    const sorted = [...entries].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    sorted.forEach((e, idx) => {
      const g = gradeEntry(e, profile);
      const extra = [entryContext(e), e.tags.join(', '), e.notes].filter(Boolean).join('. ');
      font('helvetica', 'normal', 8);
      const el = lines(extra || '-', cols[6].w).slice(0, 4);
      const need = Math.max(1, el.length) * lh(8) + 1.6;
      if (y + need > H - M - 10) {
        newPage();
        head();
      }
      if (idx % 2 === 0) {
        fill([247, 250, 248]);
        doc.rect(M - 1.5, y - 3.4, CW + 3, need + 0.4, 'F');
      }
      const tt = timeOf(e.takenAt);
      const cells = [fmtDate(tt, true), fmtTime(tt), METRIC_NAME[e.metric], entryValue(e, settings), unitFor(e.metric, settings)];
      let x = M;
      cells.forEach((c, i) => {
        font('helvetica', i === 3 ? 'bold' : 'normal', 8.4);
        color(INK);
        text(c, cols[i].right ? x + cols[i].w - 3 : x, y, cols[i].right ? { align: 'right' } : undefined);
        x += cols[i].w;
      });
      fill(LEVEL_RGB[g.level]);
      doc.circle(x + 1, y - 1, 0.9, 'F');
      font('helvetica', 'normal', 8.2);
      color(INK2);
      text(lines(g.label, cols[5].w - 4)[0], x + 3.2, y);
      x += cols[5].w;
      font('helvetica', 'normal', 8);
      color(INK2);
      el.forEach((l, j) => text(l, x, y + j * lh(8)));
      y += need;
    });
  }

  /* ---------------- Footer on every page ---------------- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(RULE);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    font('helvetica', 'normal', 7.4);
    color(MUTED);
    text('Recorded at home by the patient with Vitalis. Compared with general adult reference ranges; not a diagnosis.', M, H - 8);
    text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
}

function drawChart(
  doc: jsPDF,
  m: Metric,
  entries: Entry[],
  from: number,
  to: number,
  profile: Profile,
  settings: Settings,
  getY: () => number,
  setY: (v: number) => void,
  ensure: (n: number) => void
) {
  const chartH = 46;
  ensure(chartH + 16);
  let y = getY();
  const disp = (v: number) => toDisplay(m, v, settings);
  const unit = unitFor(m, settings);

  let series: { pts: Point[]; strength: number }[];
  let bands: Band[] = [];
  let refs: number[] = [];
  if (m === 'bp') {
    series = [
      { pts: seriesFor(entries, 'systolic', profile), strength: 1 },
      { pts: seriesFor(entries, 'diastolic', profile), strength: 0.6 }
    ];
    refs = [profile.targets.bpSystolicMax ?? 130, profile.targets.bpDiastolicMax ?? 80];
  } else {
    const pts = seriesFor(entries, m, profile).map((p) => ({ ...p, v: disp(p.v) }));
    series = [{ pts, strength: 1 }];
    const raw = m === 'hr' ? hrBands() : m === 'glucose' ? glucoseBands(profile.hasDiabetes ? 'before-meal' : 'after-meal', profile) : uricBands(profile);
    bands = raw.map((b) => ({ ...b, from: disp(b.from), to: disp(b.to) }));
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(pdfText(`${METRIC_NAME[m]} (${unit})`), M, y);
  if (m === 'bp') {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`Upper line systolic, lower line diastolic. Dashed: ${refs[0]}/${refs[1]} mmHg`), W - M, y, { align: 'right' });
  }
  y += 3;

  const all = series.flatMap((s) => s.pts);
  const px = M + 12;
  const pw = CW - 12;
  const top = y;
  const bottom = y + chartH;
  const tFrom = Math.min(from, all.length ? all[0].t : from);
  const tTo = Math.max(to, tFrom + DAY);
  const vs = all.map((p) => p.v).concat(refs);
  let lo = vs.length ? Math.min(...vs) : 0;
  let hi = vs.length ? Math.max(...vs) : 1;
  const spread = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  lo -= spread * 0.12;
  hi += spread * 0.12;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (t: number) => px + ((t - tFrom) / (tTo - tFrom)) * pw;
  const Y = (v: number) => bottom - ((v - lo) / (hi - lo)) * chartH;

  // Bands
  for (const b of bands) {
    const bt = Y(Math.min(b.to, hi));
    const bb = Y(Math.max(b.from, lo));
    if (bb - bt <= 0.1) continue;
    const c = LEVEL_RGB[b.level];
    const a = b.level === 'ok' ? 0.13 : 0.07;
    doc.setFillColor(Math.round(255 - (255 - c[0]) * a), Math.round(255 - (255 - c[1]) * a), Math.round(255 - (255 - c[2]) * a));
    doc.rect(px, bt, pw, bb - bt, 'F');
  }
  // Grid
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const dec = m === 'bp' || m === 'hr' ? 0 : decimalsFor(m, settings);
  for (let v = lo; v <= hi + 1e-9; v += step) {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.15);
    doc.line(px, Y(v), px + pw, Y(v));
    doc.setTextColor(...MUTED);
    doc.text(v.toFixed(step < 1 ? 1 : dec), px - 2, Y(v) + 1, { align: 'right' });
  }
  // Date labels
  const spanDays = (tTo - tFrom) / DAY;
  const every = spanDays <= 10 ? 1 : spanDays <= 45 ? 7 : spanDays <= 120 ? 14 : spanDays <= 400 ? 30 : 90;
  const start = new Date(tFrom);
  start.setHours(0, 0, 0, 0);
  const ticks: number[] = [];
  for (let t = start.getTime() + DAY; t < tTo; t += every * DAY) ticks.push(t);
  const stride = Math.ceil(ticks.length / 8);
  ticks.filter((_, i) => i % stride === 0).forEach((t) => doc.text(pdfText(fmtDate(t)), X(t), bottom + 4, { align: 'center' }));

  // Reference lines
  for (const r of refs) {
    if (r < lo || r > hi) continue;
    doc.setDrawColor(...INK2);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1, 1.2], 0);
    doc.line(px, Y(r), px + pw, Y(r));
    doc.setLineDashPattern([], 0);
  }

  // Series
  for (const s of series) {
    if (s.pts.length > 1) {
      const avg = movingAverage(s.pts);
      const c = s.strength < 1 ? [130, 140, 156] : INK;
      doc.setDrawColor(c[0], c[1], c[2]);
      doc.setLineWidth(0.55);
      doc.setLineJoin('round');
      for (let i = 1; i < avg.length; i++) doc.line(X(avg[i - 1].t), Y(avg[i - 1].v), X(avg[i].t), Y(avg[i].v));
    }
    const r = all.length > 150 ? 0.55 : 0.8;
    for (const p of s.pts) {
      const c = LEVEL_RGB[p.level];
      doc.setFillColor(c[0], c[1], c[2]);
      doc.circle(X(p.t), Y(p.v), s.strength < 1 ? r * 0.85 : r, 'F');
    }
  }
  if (!all.length) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.text('No readings in this period', px + pw / 2, top + chartH / 2, { align: 'center' });
  }
  y = bottom + 11;
  setY(y);
}

export function reportFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Vitalis-report-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
}

export { LEVEL_LABEL };
