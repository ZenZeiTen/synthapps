import { useMemo, useState } from 'react';
import { TrendChart, type ChartSeries, type RefLine } from '../components/TrendChart';
import { Distribution } from '../components/Visuals';
import { EntryRow } from './Journal';
import { locale, num, t } from '../i18n';
import { glucoseContextLabel, metricName, signed } from '../lib/format';
import { glucoseBands, hrBands, uricBands, type Band } from '../lib/ranges';
import { DAY, hourOf, mean, movingAverage, seriesFor, summarize, timeOf, type Point } from '../lib/stats';
import { METRICS, type GlucoseContext, type Level, type Metric } from '../lib/types';
import { decimalsFor, toDisplay, unitFor } from '../lib/units';
import { useApp } from '../state';

const PERIODS = [7, 30, 90, 365, 0];

/** Hour ranges for the time-of-day averages; names come from the dictionary. */
const TOD = [
  { from: 4, to: 11 },
  { from: 11, to: 17 },
  { from: 17, to: 24 },
  { from: 0, to: 4 }
];
const GLUCOSE_CONTEXTS: GlucoseContext[] = ['fasting', 'before-meal', 'after-meal', 'bedtime', 'random'];

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
  const T = t().trends;
  const fmt = (v: number) => num(disp(v), dec);
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
      { id: 'sys', label: T.systolic, points: s, average: movingAverage(s) },
      { id: 'dia', label: T.diastolic, points: d, average: movingAverage(d), strength: 0.7 }
    ];
    lines = [
      { v: profile.targets.bpSystolicMax ?? 130, label: T.bpLine(profile.targets.bpSystolicMax ?? 130) },
      { v: profile.targets.bpDiastolicMax ?? 80, label: T.diaLine(profile.targets.bpDiastolicMax ?? 80) }
    ];
  } else {
    const key = metric === 'hr' ? 'hr' : metric;
    primary = seriesFor(metricEntries, key, profile);
    series = [{ id: metric, label: metricName(metric), points: conv(primary), average: primary.length > 4 ? movingAverage(conv(primary)) : undefined }];
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
      ? TOD.map((slot, i) => {
          const pts = primary.filter((p) => {
            const h = hourOf(p.t);
            return h >= slot.from && h < slot.to;
          });
          const dpts = metric === 'bp' ? seriesFor(metricEntries, 'diastolic', profile).filter((p) => { const h = hourOf(p.t); return h >= slot.from && h < slot.to; }) : [];
          return { ...slot, label: T.tod[i][0], hint: T.tod[i][1], n: pts.length, text: !pts.length ? '-' : metric === 'bp' ? `${Math.round(mean(pts.map((p) => p.v)))}/${Math.round(mean(dpts.map((p) => p.v)))}` : fmt(mean(pts.map((p) => p.v))) };
        })
      : null;

  const listEntries = metricEntries.slice(0, 30);
  const trend = sum.trend30;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{T.title}</h1>
          <p>{T.intro}</p>
        </div>
      </div>

      <div className="trend-controls">
        <div className="segmented" role="group" aria-label={T.measurement}>
          {METRICS.map((m) => (
            <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {metricName(m)}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label={T.period}>
          {PERIODS.map((p) => (
            <button key={p} aria-pressed={days === p} onClick={() => setDays(p)}>
              {T.periods[p]}
            </button>
          ))}
        </div>
      </div>

      {metric === 'glucose' && (
        <div className="chips" style={{ marginBottom: 14 }} role="group" aria-label={T.glucoseShow}>
          <button className="chip" aria-pressed={gctx === 'all'} onClick={() => setGctx('all')}>{T.allReadings}</button>
          {GLUCOSE_CONTEXTS.map((c) => (
            <button key={c} className="chip" aria-pressed={gctx === c} onClick={() => setGctx(c)}>
              {glucoseContextLabel(c)}
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
          format={(v) => (metric === 'bp' ? String(Math.round(v)) : num(v, dec))}
          onPick={(id) => {
            const e = entries.find((x) => x.id === id);
            if (e) openLog({ entry: e });
          }}
        />
        <div className="legend">
          {metric === 'bp' ? (
            <>
              <span><i /> {T.legendBpAverage}</span>
              <span><i className="dashed" /> {T.legendThresholds}</span>
            </>
          ) : (
            <>
              <span><i /> {T.legendAverage}</span>
              <span><i className="band lv-ok" style={{ background: 'color-mix(in srgb, var(--lv-ok) 25%, transparent)' }} /> {metric === 'glucose' && gctx === 'all' ? (profile.hasDiabetes ? T.legendBeforeMealTarget : T.legendUsualOutsideFasting) : T.legendRange}</span>
            </>
          )}
        </div>
      </div>

      <div className="strip" style={{ marginTop: 14 }}>
        <div>
          <div className="stat-label">{T.average}</div>
          <div className="stat-value">{avgText}<small>{unit}</small></div>
        </div>
        <div>
          <div className="stat-label">{T.lowHigh}</div>
          <div className="stat-value">{rangeText}</div>
        </div>
        <div>
          <div className="stat-label">{T.inRange}</div>
          <div className="stat-value">{Number.isNaN(sum.inRange) ? '-' : `${Math.round(sum.inRange * 100)}%`}</div>
        </div>
        <div>
          <div className="stat-label">{T.trendMonth}</div>
          <div className="stat-value">
            {trend === null ? <span className="muted" style={{ fontSize: 15 }}>{T.needsMore}</span> : <>{metric === 'bp' ? signed(trend) : signed(disp(trend), dec)}<small>{metric === 'bp' ? T.systolic : unit}</small></>}
          </div>
        </div>
      </div>

      {sum.count > 0 && (
        <section className="section">
          <div className="section-head"><h2>{T.howTheyFall}</h2></div>
          <div className="panel panel-pad stack">
            <Distribution counts={counts} />
            {tod && (
              <div className="tod">
                {tod.map((s) => (
                  <div key={s.label}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={{ fontSize: 21 }}>{s.text}</div>
                    <div className="hint">{s.n ? t().common.readings(s.n) : s.hint}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{T.readings}</h2>
          {metricEntries.length > listEntries.length && <button className="btn btn-ghost btn-sm" onClick={() => go('journal')}>{T.seeAll(metricEntries.length)}</button>}
        </div>
        {listEntries.length ? (
          <div className="list">
            {listEntries.map((e) => <EntryRow key={e.id} entry={e} showDate />)}
          </div>
        ) : (
          <div className="panel empty">
            <p>{T.noneInPeriod(metricName(metric).toLocaleLowerCase(locale()))}</p>
            <button className="btn btn-primary" onClick={() => openLog({ metric })}>{t().nav.logReading}</button>
          </div>
        )}
      </section>
    </>
  );
}
