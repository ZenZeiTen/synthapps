import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Status } from '../components/Visuals';
import { entryContext, entryUnit, entryValue, fmtDate, fmtDayHeading, fmtTime, METRIC_NAME } from '../lib/format';
import { gradeEntry } from '../lib/ranges';
import { timeOf } from '../lib/stats';
import { METRICS, type Entry, type Metric } from '../lib/types';
import { useApp } from '../state';

export function EntryRow({ entry, showDate = false }: { entry: Entry; showDate?: boolean }) {
  const { profile, settings, openLog } = useApp();
  const g = gradeEntry(entry, profile);
  const t = timeOf(entry.takenAt);
  const sub = [entryContext(entry), entry.tags.join(', '), entry.notes].filter(Boolean).join(' — ');
  return (
    <button className={`row m-${entry.metric}`} onClick={() => openLog({ entry })} aria-label={`${METRIC_NAME[entry.metric]} ${entryValue(entry, settings)} ${entryUnit(entry, settings)}, ${g.label}. Edit`}>
      <span className="row-time">
        {showDate ? (
          <>
            {fmtDate(t)}
            <br />
            <span style={{ fontWeight: 500 }}>{fmtTime(t)}</span>
          </>
        ) : (
          fmtTime(t)
        )}
      </span>
      <span className="row-main">
        <span className="row-value">
          <span className="metric-dot" style={{ background: 'var(--m)' }} aria-hidden="true" />
          <strong>{entryValue(entry, settings)}</strong>
          <span className="unit">{entryUnit(entry, settings)}</span>
          <span className="hint">{METRIC_NAME[entry.metric]}</span>
        </span>
        {sub && <span className="row-sub" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <Status level={g.level} label={g.label} />
    </button>
  );
}

export function Journal() {
  const { entries, openLog } = useApp();
  const [filter, setFilter] = useState<Metric | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(120);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => (filter === 'all' || e.metric === filter) && (!q || `${e.notes} ${e.tags.join(' ')}`.toLowerCase().includes(q)));
  }, [entries, filter, query]);

  const groups = useMemo(() => {
    const out: { day: string; items: Entry[] }[] = [];
    for (const e of shown.slice(0, limit)) {
      const day = e.takenAt.slice(0, 10);
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [shown, limit]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Journal</h1>
          <p>Every reading, newest first. Choose one to edit or delete it.</p>
        </div>
      </div>

      <div className="trend-controls">
        <div className="segmented" role="group" aria-label="Show">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          {METRICS.map((m) => (
            <button key={m} aria-pressed={filter === m} onClick={() => setFilter(m)}>
              {METRIC_NAME[m]}
            </button>
          ))}
        </div>
        <label style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
          <span className="sr-only">Search notes and tags</span>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 14, color: 'var(--muted)' }} aria-hidden="true" />
          <input className="input" style={{ paddingLeft: 36, borderRadius: 999 }} placeholder="Search notes and tags" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {!entries.length ? (
        <div className="panel empty">
          <h2>Your journal is empty</h2>
          <p>Readings you log appear here with their date, time, context and notes.</p>
          <button className="btn btn-primary" onClick={() => openLog()}>Log a reading</button>
        </div>
      ) : !shown.length ? (
        <div className="panel empty">
          <p>No readings match. Try another filter or search.</p>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.day}>
              <div className="day-head">
                {fmtDayHeading(timeOf(`${g.day}T12:00`))}
                <small>{g.items.length} {g.items.length === 1 ? 'reading' : 'readings'}</small>
              </div>
              <div className="list">
                {g.items.map((e) => <EntryRow key={e.id} entry={e} />)}
              </div>
            </section>
          ))}
          {shown.length > limit && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
              <button className="btn" onClick={() => setLimit((l) => l + 200)}>Show older readings</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
