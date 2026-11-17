import { useMemo, useState } from 'react';
import { TrendChart, type ChartSeries, type RefLine } from '../components/TrendChart';
import { Distribution } from '../components/Visuals';
import { EntryRow } from './Journal';
import { METRIC_NAME, signed } from '../lib/format';
import { GLUCOSE_CONTEXT_LABEL, glucoseBands, hrBands, uricBands, type Band } from '../lib/ranges';
import { DAY, hourOf, mean, movingAverage, seriesFor, summarize, timeOf, type Point } from '../lib/stats';
import { METRICS, type GlucoseContext, type Level, type Metric } from '../lib/types';
import { decimalsFor, toDisplay, unitFor } from '../lib/units';
import { useApp } from '../state';

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
  { days: 0, label: 'All' }
];

const TOD = [
  { label: 'Morning', hint: '4:00-11:00', from: 4, to: 11 },
  { label: 'Midday', hint: '11:00-17:00', from: 11, to: 17 },
  { label: 'Evening', hint: '17:00-24:00', from: 17, to: 24 },
  { label: 'Night', hint: '0:00-4:00', from: 0, to: 4 }
];

export function Trends() {
  const { entries, profile, settings, trendMetric, go, openLog } = useApp();
  const [metric, setMetric] = useState<Metric>(trendMetric);
  const [days, setDays] = useState(30);
  const [gctx, setGctx] = useState<GlucoseContext | 'all'>('all');
  const now = Date.now();
  const from = days ? now - days * DAY : entries.length ? Math.min(...entries.map((e) => timeOf(e.takenAt))) : now - 30 * DAY;

  const inWin = useMemo(() => entries.filter((e) => timeOf(e.takenAt) >= from), [entries, from]);
  const metricEntries = useMemo(
    () => inWin.filter((e) => (metric === 'hr' ? e.metric === 'hr' || (e.metric === 'bp' && e.pulse) : e.metric === metric)).filter((e) => metric !== 'glucose' || gctx === 'all' || e.glucoseContext === gctx),
    [inWin, metric, gctx]
  );

  const disp = (v: number) => toDisplay(metric, v, settings);
  const dec = decimalsFor(metric, settings);
  const fmt = (v: number) => disp(v).toFixed(dec);
  const unit = unitFor(metric, settings);

  // Chart in display units.
  const conv = (pts: Point[]): Point[] => pts.map((p) => ({ ...p, v: disp(p.v) }));
  const convBands = (bs: Band[]): Band[] => bs.map((b) => ({ ...b, from: disp(b.from), to: disp(b.to) }));

  let series: ChartSeries[] = [];
  let bands: Band[] = [];
  let lines: RefLine[] = [];
  let primary: Point[] = [];
  if (metric === 'bp') {
    const s = seriesFor(metricEntries, 'systolic', profile);
    const d = seriesFor(metricEntries, 'diastolic', profile);
    primary = s;
    series = [
      { id: 'sys', label: 'systolic', points: s, average: movingAverage(s) },
      { id: 'dia', label: 'diastolic', points: d, average: movingAverage(d), strength: 0.7 }
    ];
    lines = [
      { v: profile.targets.bpSystolicMax ?? 130, label: `${profile.targets.bpSystolicMax ?? 130} systolic` },
      { v: profile.targets.bpDiastolicMax ?? 80, label: `${profile.targets.bpDiastolicMax ?? 80} diastolic` }
    ];
  } else {
    const key = metric === 'hr' ? 'hr' : metric;
    primary = seriesFor(metricEntries, key, profile);
    series = [{ id: metric, label: METRIC_NAME[metric], points: conv(primary), average: primary.length > 4 ? movingAverage(conv(primary)) : undefined }];
    if (metric === 'hr') bands = hrBands();
    if (metric === 'glucose') bands = convBands(glucoseBands(gctx === 'all' ? (profile.hasDiabetes ? 'before-meal' : 'after-meal') : gctx, profile));
    if (metric === 'uric') bands = convBands(uricBands(profile));
  }

  const sum = summarize(primary);
  const dia = metric === 'bp' ? summarize(seriesFor(metricEntries, 'diastolic', profile)) : null;
  const avgText = !sum.count ? '-' : metric === 'bp' ? `${Math.round(sum.mean)}/${Math.round(dia?.mean ?? 0)}` : fmt(sum.mean);
  const rangeText = !sum.count ? '-' : metric === 'bp' ? `${sum.min}-${sum.max}` : `${fmt(sum.min)}-${fmt(sum.max)}`;

  const counts: Partial<Record<Level, number>> = {};
  for (const e of metricEntries) {
    // Distribution uses the whole-reading grade (both blood pressure numbers together).
    const pts = metric === 'bp' ? seriesFor([e], 'systolic', profile) : seriesFor([e], metric === 'hr' ? 'hr' : metric, profile);
    for (const p of pts) counts[p.level] = (counts[p.level] ?? 0) + 1;
  }

  const tod =
    metric === 'bp' || metric === 'glucose' || metric === 'hr'
      ? TOD.map((slot) => {
          const pts = primary.filter((p) => {
            const h = hourOf(p.t);
            return h >= slot.from && h < slot.to;
          });
          const dpts = metric === 'bp' ? seriesFor(metricEntries, 'diastolic', profile).filter((p) => { const h = hourOf(p.t); return h >= slot.from && h < slot.to; }) : [];
          return { ...slot, n: pts.length, text: !pts.length ? '-' : metric === 'bp' ? `${Math.round(mean(pts.map((p) => p.v)))}/${Math.round(mean(dpts.map((p) => p.v)))}` : fmt(mean(pts.map((p) => p.v))) };
        })
      : null;

  const listEntries = metricEntries.slice(0, 30);
  const trend = sum.trend30;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trends</h1>
          <p>Each dot is a reading, coloured by what it means. The bold line is the 7-day average.</p>
        </div>
      </div>

      <div className="trend-controls">
        <div className="segmented" role="group" aria-label="Measurement">
          {METRICS.map((m) => (
            <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {METRIC_NAME[m]}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.label} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {metric === 'glucose' && (
        <div className="chips" style={{ marginBottom: 14 }} role="group" aria-label="Glucose readings to show">
          <button className="chip" aria-pressed={gctx === 'all'} onClick={() => setGctx('all')}>All readings</button>
          {(Object.keys(GLUCOSE_CONTEXT_LABEL) as GlucoseContext[]).map((c) => (
            <button key={c} className="chip" aria-pressed={gctx === c} onClick={() => setGctx(c)}>
              {GLUCOSE_CONTEXT_LABEL[c]}
            </button>
          ))}
        </div>
      )}

      <div className="panel panel-pad">
        <TrendChart
          series={series}
          bands={bands}
          lines={lines}
          from={from}
          to={now}
          unit={unit}
          format={(v) => (metric === 'bp' ? String(Math.round(v)) : v.toFixed(dec))}
          onPick={(id) => {
            const e = entries.find((x) => x.id === id);
            if (e) openLog({ entry: e });
          }}
        />
        <div className="legend">
          {metric === 'bp' ? (
            <>
              <span><i /> 7-day average (upper: systolic, lower: diastolic)</span>
              <span><i className="dashed" /> Stage 1 thresholds</span>
            </>
          ) : (
            <>
              <span><i /> 7-day average</span>
              <span><i className="band lv-ok" style={{ background: 'color-mix(in srgb, var(--lv-ok) 25%, transparent)' }} /> {metric === 'glucose' && gctx === 'all' ? `${profile.hasDiabetes ? 'Before-meal target' : 'Usual range outside fasting'}` : 'Usual range'}</span>
            </>
          )}
        </div>
      </div>

      <div className="strip" style={{ marginTop: 14 }}>
        <div>
          <div className="stat-label">Average</div>
          <div className="stat-value">{avgText}<small>{unit}</small></div>
        </div>
        <div>
          <div className="stat-label">Lowest to highest</div>
          <div className="stat-value">{rangeText}</div>
        </div>
        <div>
          <div className="stat-label">In range</div>
          <div className="stat-value">{Number.isNaN(sum.inRange) ? '-' : `${Math.round(sum.inRange * 100)}%`}</div>
        </div>
        <div>
          <div className="stat-label">Trend per month</div>
          <div className="stat-value">
            {trend === null ? <span className="muted" style={{ fontSize: 15 }}>Needs 5+ readings over a week</span> : <>{metric === 'bp' ? signed(trend) : signed(disp(trend), dec)}<small>{metric === 'bp' ? 'systolic' : unit}</small></>}
          </div>
        </div>
      </div>

      {sum.count > 0 && (
        <section className="section">
          <div className="section-head"><h2>How readings fall</h2></div>
          <div className="panel panel-pad stack">
            <Distribution counts={counts} />
            {tod && (
              <div className="tod">
                {tod.map((s) => (
                  <div key={s.label}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={{ fontSize: 21 }}>{s.text}</div>
                    <div className="hint">{s.n ? `${s.n} ${s.n === 1 ? 'reading' : 'readings'}` : s.hint}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Readings</h2>
          {metricEntries.length > listEntries.length && <button className="btn btn-ghost btn-sm" onClick={() => go('journal')}>See all {metricEntries.length}</button>}
        </div>
        {listEntries.length ? (
          <div className="list">
            {listEntries.map((e) => <EntryRow key={e.id} entry={e} showDate />)}
          </div>
        ) : (
          <div className="panel empty">
            <p>No {METRIC_NAME[metric].toLowerCase()} readings in this period.</p>
            <button className="btn btn-primary" onClick={() => openLog({ metric })}>Log a reading</button>
          </div>
        )}
      </section>
    </>
  );
}
