import { useMemo } from 'react';
import { AlertTriangle, FileText, Plus } from 'lucide-react';
import { RangeRuler, Sparkline, Status } from '../components/Visuals';
import { locale, t } from '../i18n';
import { fmtWhen, glucoseContextLabel, metricName } from '../lib/format';
import { analyze } from '../lib/insights';
import { diastolicBands, glucoseBands, gradeEntry, hrBands, systolicBands, uricBands } from '../lib/ranges';
import { DAY, loggingStreak, seriesFor, timeOf, type SeriesKey } from '../lib/stats';
import { METRICS, type Entry, type Metric } from '../lib/types';
import { formatValue, unitFor } from '../lib/units';
import { useApp } from '../state';

function greeting(name: string): string {
  return t().today.greeting(new Date().getHours(), name.trim().split(' ')[0] ?? '');
}

const KEY: Record<Metric, SeriesKey> = { bp: 'systolic', hr: 'hr', glucose: 'glucose', uric: 'uric' };

export function Today() {
  const { entries, profile, settings, openLog, go } = useApp();
  const now = Date.now();
  const analysis = useMemo(() => analyze(entries, profile, settings, 30), [entries, profile, settings]);
  const latest = useMemo(() => {
    const m: Partial<Record<Metric, Entry>> = {};
    for (const e of entries) if (!m[e.metric]) m[e.metric] = e; // entries are newest first
    return m;
  }, [entries]);
  const streak = loggingStreak(entries);
  const recent = entries.filter((e) => timeOf(e.takenAt) > now - 2 * DAY);
  const urgent = recent.find((e) => gradeEntry(e, profile).level === 'urgent');
  const top = analysis.insights.filter((i) => i.level !== 'neutral').slice(0, 3);
  const weekCount = entries.filter((e) => timeOf(e.takenAt) > now - 7 * DAY).length;

  const T = t().today;
  const dateLine = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting(profile.name)}</h1>
          <p>
            {dateLine}.{' '}
            {entries.length
              ? T.summary(weekCount, streak)
              : T.firstReading}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openLog()}>
          <Plus size={18} /> {t().nav.logReading}
        </button>
      </div>

      {urgent && (
        <div className="alert" role="alert" style={{ marginBottom: 18 }}>
          <AlertTriangle size={20} />
          <div>
            <strong>
              {metricName(urgent.metric)}, {fmtWhen(urgent.takenAt)}: {gradeEntry(urgent, profile).label.toLocaleLowerCase(locale())}
            </strong>
            {gradeEntry(urgent, profile).detail}{' '}
            <a href="#/insights" onClick={(e) => { e.preventDefault(); go('insights'); }}>{T.urgentCare}</a>
          </div>
        </div>
      )}

      <div className="today-grid">
        {METRICS.map((m) => (
          <ReadingCard key={m} metric={m} entry={latest[m]} spark={seriesFor(entries.filter((e) => timeOf(e.takenAt) > now - 30 * DAY), KEY[m], profile)} />
        ))}
      </div>

      {entries.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{T.standsOut}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => go('insights')}>{T.allInsights}</button>
          </div>
          {top.length ? (
            <div className="list">
              {top.map((i) => (
                <div key={i.id} className={`finding lv-${i.level}`}>
                  <span className="finding-mark" />
                  <h3>{i.title}</h3>
                  <p>{i.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{T.nothingStandsOut}</p>
          )}
        </section>
      )}

      <section className="section">
        <div className="panel panel-pad" style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '56ch' }}>
            <h2>{T.doctorSoon}</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              {T.doctorSoonBody}
            </p>
          </div>
          <button className="btn" onClick={() => go('report')}>
            <FileText size={17} /> {T.makeReport}
          </button>
        </div>
      </section>
    </>
  );
}

function ReadingCard({ metric, entry, spark }: { metric: Metric; entry?: Entry; spark: ReturnType<typeof seriesFor> }) {
  const T = t().today;
  const { profile, settings, openLog, go } = useApp();
  const grade = entry ? gradeEntry(entry, profile) : null;
  const unit = unitFor(metric, settings);
  const fmt = (v: number) => formatValue(metric, v, settings);

  let ruler: React.ReactNode = null;
  if (entry) {
    if (metric === 'bp') ruler = <RangeRuler bands={systolicBands(profile)} value={entry.systolic} min={80} max={200} label={T.systolic} />;
    if (metric === 'hr') ruler = grade?.level === 'neutral' ? null : <RangeRuler bands={hrBands()} value={entry.value} min={30} max={150} />;
    if (metric === 'glucose') ruler = <RangeRuler bands={glucoseBands(entry.glucoseContext ?? 'random', profile)} value={entry.value} min={40} max={320} format={(v) => formatValue('glucose', v, settings)} />;
    if (metric === 'uric') ruler = <RangeRuler bands={uricBands(profile)} value={entry.value} min={1} max={12} format={(v) => formatValue('uric', v, settings)} />;
  }

  if (!entry) {
    return (
      <div className={`reading-card m-${metric}`}>
        <div className="reading-top">
          <span className="reading-name">{metricName(metric)}</span>
        </div>
        <div className="reading-empty">
          <span>{T.noReadings}</span>
          <button className="btn btn-sm" onClick={() => openLog({ metric })}>
            <Plus size={15} /> {T.add(T.addWhat[metric])}
          </button>
        </div>
      </div>
    );
  }

  const sub =
    metric === 'glucose'
      ? glucoseContextLabel(entry.glucoseContext ?? 'random')
      : metric === 'bp' && entry.pulse
        ? T.pulse(entry.pulse)
        : null;

  return (
    <button className={`reading-card m-${metric}`} onClick={() => go('trends', metric)} aria-label={T.openTrends(metricName(metric))}>
      <div className="reading-top">
        <span className="reading-name">{metricName(metric)}</span>
        <span className="reading-when">{fmtWhen(entry.takenAt)}</span>
      </div>
      <div className="reading-value">
        <span className="numeral">
          {metric === 'bp' ? (
            <>
              {entry.systolic}
              <span className="slash">/</span>
              {entry.diastolic}
            </>
          ) : (
            fmt(entry.value ?? 0)
          )}
        </span>
        <span className="unit">{unit}</span>
      </div>
      {ruler}
      {metric === 'bp' && <RangeRuler bands={diastolicBands(profile)} value={entry.diastolic} min={50} max={130} label={T.diastolic} />}
      <div className="reading-foot">
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {grade && <Status level={grade.level} label={grade.label} />}
          {sub && <span className="hint">{sub}</span>}
        </span>
        <Sparkline values={spark.slice(-20).map((p) => p.v)} levels={spark.slice(-20).map((p) => p.level)} />
      </div>
    </button>
  );
}
