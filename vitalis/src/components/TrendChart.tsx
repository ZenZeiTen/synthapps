import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Band } from '../lib/ranges';
import { LEVEL_LABEL } from '../lib/ranges';
import { DAY, type Point } from '../lib/stats';
import { fmtDate, fmtTime } from '../lib/format';

export interface ChartSeries {
  id: string;
  label: string;
  points: Point[];
  /** Line opacity; the second series of blood pressure is drawn lighter. */
  strength?: number;
  average?: { t: number; v: number }[];
}

export interface RefLine {
  v: number;
  label: string;
}

interface Props {
  series: ChartSeries[];
  bands?: Band[];
  lines?: RefLine[];
  from: number;
  to: number;
  unit: string;
  height?: number;
  format: (v: number) => string;
  /** Called when a point is chosen, with the entry id. */
  onPick?: (entryId: string) => void;
}

function niceStep(range: number, target = 5): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function TrendChart({ series, bands = [], lines = [], from, to, unit, height = 280, format, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, '');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  const pad = { l: 40, r: 14, t: 14, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const domain = useMemo(() => {
    const vs = all.map((p) => p.v).concat(lines.map((l) => l.v));
    if (!vs.length) return { lo: 0, hi: 1, step: 1 };
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const spread = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
    lo -= spread * 0.12;
    hi += spread * 0.12;
    const step = niceStep(hi - lo);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }, [all, lines]);

  const tFrom = Math.min(from, all.length ? all[0].t : from);
  const tTo = Math.max(to, tFrom + DAY);
  const x = (t: number) => pad.l + ((t - tFrom) / (tTo - tFrom)) * w;
  const y = (v: number) => pad.t + h - ((v - domain.lo) / (domain.hi - domain.lo)) * h;

  const yTicks: number[] = [];
  for (let v = domain.lo; v <= domain.hi + 1e-9; v += domain.step) yTicks.push(Number(v.toFixed(6)));

  const spanDays = (tTo - tFrom) / DAY;
  const xTicks: number[] = [];
  const tickEvery = spanDays <= 10 ? 1 : spanDays <= 45 ? 7 : spanDays <= 120 ? 14 : spanDays <= 400 ? 30 : 90;
  const start = new Date(tFrom);
  start.setHours(0, 0, 0, 0);
  for (let t = start.getTime() + DAY; t < tTo; t += tickEvery * DAY) xTicks.push(t);
  const maxTicks = Math.max(2, Math.floor(w / 70));
  const stride = Math.ceil(xTicks.length / maxTicks);
  const shownX = xTicks.filter((_, i) => i % stride === 0);

  // Points ordered by time across series, for hover lookup.
  const ordered = useMemo(() => {
    const byT = new Map<number, { t: number; items: { s: ChartSeries; p: Point }[] }>();
    for (const s of series) for (const p of s.points) {
      const g = byT.get(p.t) ?? { t: p.t, items: [] };
      g.items.push({ s, p });
      byT.set(p.t, g);
    }
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }, [series]);

  const pickAt = (clientX: number) => {
    const el = ref.current;
    if (!el || !ordered.length) return null;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    ordered.forEach((g, i) => {
      const d = Math.abs(x(g.t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const path = (pts: { t: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const hovered = hover !== null ? ordered[hover] : null;
  const tipLeft = hovered ? Math.min(Math.max(x(hovered.t), 80), width - 80) : 0;

  const onKey = (e: React.KeyboardEvent) => {
    if (!ordered.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = hover ?? (e.key === 'ArrowRight' ? -1 : ordered.length);
      setHover(Math.min(ordered.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Enter' && hovered && onPick) {
      onPick(hovered.items[0].p.entryId);
    } else if (e.key === 'Escape') setHover(null);
  };

  return (
    <div
      ref={ref}
      className="chart-wrap"
      tabIndex={0}
      role="group"
      aria-label={`Chart of ${series.map((s) => s.label).join(' and ')}, ${all.length} readings. Use the arrow keys to step through readings${onPick ? ' and Enter to open one' : ''}.`}
      onPointerMove={(e) => setHover(pickAt(e.clientX))}
      onPointerDown={(e) => setHover(pickAt(e.clientX))}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect x={pad.l} y={pad.t} width={w} height={h} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {bands.map((b) => {
            const top = y(Math.min(b.to, domain.hi));
            const bottom = y(Math.max(b.from, domain.lo));
            if (bottom <= top) return null;
            return <rect key={b.label + b.from} x={pad.l} y={top} width={w} height={bottom - top} fill={`var(--lv-${b.level})`} opacity={b.level === 'ok' ? 0.09 : 0.06} />;
          })}
        </g>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + w} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {format(v)}
            </text>
          </g>
        ))}
        {shownX.map((t) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {fmtDate(t)}
          </text>
        ))}
        {lines.map((l) => (
          <g key={l.label}>
            <line x1={pad.l} x2={pad.l + w} y1={y(l.v)} y2={y(l.v)} stroke="var(--ink)" strokeOpacity="0.35" strokeDasharray="3 4" />
            <text x={pad.l + w - 4} y={y(l.v) - 5} textAnchor="end" fontSize="10.5" fontWeight="600" fill="var(--muted)">
              {l.label}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {series.map((s) => (
            <g key={s.id}>
              {s.points.length > 1 && <path d={path(s.points)} fill="none" stroke="var(--ink)" strokeOpacity={0.22 * (s.strength ?? 1)} strokeWidth="1.2" />}
              {s.average && s.average.length > 1 && (
                <path d={path(s.average)} fill="none" stroke="var(--ink)" strokeOpacity={0.85 * (s.strength ?? 1)} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {s.points.map((p) => (
                <circle key={p.entryId + s.id} cx={x(p.t)} cy={y(p.v)} r={all.length > 120 ? 2.6 : 3.6} fill={`var(--lv-${p.level})`} stroke="var(--surface)" strokeWidth="1.4" opacity={s.strength ?? 1} />
              ))}
            </g>
          ))}
        </g>
        {hovered && (
          <g>
            <line x1={x(hovered.t)} x2={x(hovered.t)} y1={pad.t} y2={pad.t + h} stroke="var(--ink)" strokeOpacity="0.4" />
            {hovered.items.map(({ s, p }) => (
              <circle key={s.id} cx={x(p.t)} cy={y(p.v)} r="6" fill="none" stroke="var(--ink)" strokeWidth="2" />
            ))}
          </g>
        )}
        {!all.length && (
          <text x={pad.l + w / 2} y={pad.t + h / 2} textAnchor="middle" fontSize="14" fill="var(--muted)">
            No readings in this period
          </text>
        )}
      </svg>
      {hovered && (
        <div className="chart-tip" style={{ left: tipLeft }}>
          <div className="tip-when">
            {fmtDate(hovered.t, true)}, {fmtTime(hovered.t)}
          </div>
          {hovered.items.map(({ s, p }) => (
            <div key={s.id}>
              <b>{format(p.v)}</b>
              {series.length > 1 ? s.label : unit}
            </div>
          ))}
          <div className="tip-when" style={{ marginTop: 2, marginBottom: 0 }}>{LEVEL_LABEL[hovered.items[0].p.level]}</div>
        </div>
      )}
    </div>
  );
}
