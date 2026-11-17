import type { Band } from '../lib/ranges';
import type { Level } from '../lib/types';
import { LEVEL_LABEL } from '../lib/ranges';

export function Status({ level, label }: { level: Level; label?: string }) {
  return <span className={`status lv-${level}`}>{label ?? LEVEL_LABEL[level]}</span>;
}

export function Logo({ size = 28 }: { size?: number }) {
  // A heart-rhythm trace drawn as a single ink line inside a rounded square.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--ink)" />
      <path d="M5 17.5h5.2l2.3-6 3.4 11 2.6-8.2 1.6 3.2H27" fill="none" stroke="var(--paper)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A flat gauge: the category bands laid end to end, with a marker at the
 * reading. Shows at a glance where a number sits between "normal" and
 * "severe" without needing to know the thresholds.
 */
export function RangeRuler({
  bands,
  value,
  min,
  max,
  label,
  format = (v) => String(v)
}: {
  bands: Band[];
  value?: number;
  min: number;
  max: number;
  label?: string;
  format?: (v: number) => string;
}) {
  const span = max - min;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const pos = (v: number) => ((clamp(v) - min) / span) * 100;
  const visible = bands.filter((b) => b.to > min && b.from < max);
  const current = value === undefined ? undefined : visible.find((b) => value >= b.from && value < b.to) ?? visible[visible.length - 1];
  // Label band edges, skipping any that would crowd the previous label.
  const ticks: { at: number; label: number }[] = [];
  for (const b of visible.slice(1)) {
    if (b.from <= min || b.from >= max) continue;
    const prev = ticks[ticks.length - 1];
    if (prev && pos(b.from) - pos(prev.at) < 9) continue;
    ticks.push({ at: b.from, label: b.edge ?? b.from });
  }
  return (
    <div className="ruler" role="img" aria-label={`${label ? `${label}: ` : ''}${value !== undefined && current ? `${format(value)}, ${current.label}` : 'no reading'}`}>
      {label && <span className="ruler-label">{label}</span>}
      <div className="ruler-track">
        {visible.map((b, i) => {
          const w = pos(Math.min(b.to, max)) - pos(Math.max(b.from, min));
          const edge = i === 0 ? ' is-first' : i === visible.length - 1 ? ' is-last' : '';
          return <div key={b.label + b.from} className={`ruler-seg lv-${b.level}${b === current ? ' is-current' : ''}${edge}`} style={{ width: `${w}%` }} title={b.label} />;
        })}
        {value !== undefined && <div className="ruler-marker" style={{ left: `${pos(value)}%` }} />}
      </div>
      <div className="ruler-ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t.at} style={{ left: `${pos(t.at)}%` }}>
            {format(t.label)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values, levels, width = 110, height = 30 }: { values: number[]; levels?: Level[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.15 || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => height - 3 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--ink)" strokeOpacity="0.55" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="3.2" fill={`var(--lv-${levels?.[last] ?? 'neutral'})`} stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  );
}

export function Distribution({ counts }: { counts: Partial<Record<Level, number>> }) {
  const order: Level[] = ['low', 'ok', 'mild', 'watch', 'high', 'urgent', 'neutral'];
  const total = order.reduce((a, l) => a + (counts[l] ?? 0), 0);
  if (!total) return null;
  return (
    <div>
      <div className="distribution" role="img" aria-label={order.filter((l) => counts[l]).map((l) => `${LEVEL_LABEL[l]} ${Math.round(((counts[l] ?? 0) / total) * 100)}%`).join(', ')}>
        {order.map((l) => (counts[l] ? <div key={l} className={`lv-${l}`} style={{ flex: counts[l] }} /> : null))}
      </div>
      <div className="dist-legend">
        {order.map((l) =>
          counts[l] ? (
            <span key={l} className={`lv-${l}`}>
              {LEVEL_LABEL[l]} {Math.round(((counts[l] ?? 0) / total) * 100)}%
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}
