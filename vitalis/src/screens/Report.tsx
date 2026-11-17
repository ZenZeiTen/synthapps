import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Share2 } from 'lucide-react';
import { makeCsv } from '../lib/backup';
import { fmtDate, METRIC_NAME } from '../lib/format';
import { analyze } from '../lib/insights';
import type { ReportOptions } from '../lib/pdf';
import { canShareFiles, saveFile, shareFile } from '../lib/save';
import { DAY, entriesInWindow } from '../lib/stats';
import { formatValue, unitFor } from '../lib/units';
import { useApp } from '../state';

const PERIODS = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 180, label: 'Last 6 months' },
  { days: 365, label: 'Last year' },
  { days: 0, label: 'All readings' }
];

const SECTIONS: { key: keyof ReportOptions; label: string; hint: string }[] = [
  { key: 'summary', label: 'Summary table', hint: 'Averages, ranges and trends for each measurement' },
  { key: 'charts', label: 'Charts', hint: 'One chart per measurement' },
  { key: 'insights', label: 'Findings', hint: 'What the readings suggest, in plain language' },
  { key: 'questions', label: 'Questions', hint: 'The questions ticked on the Insights page, with space for answers' },
  { key: 'tests', label: 'Tests and doctors', hint: 'Tests to ask about, who to see and when to get urgent care' },
  { key: 'log', label: 'All readings', hint: 'A table of every reading with its notes' }
];

export function Report() {
  const { entries, profile, settings, notify, go } = useApp();
  const [days, setDays] = useState(90);
  const [opts, setOpts] = useState<ReportOptions>({ summary: true, charts: true, insights: true, questions: true, tests: true, log: true });
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const inPeriod = useMemo(() => entriesInWindow(entries, days ? now - days * DAY : -Infinity, now), [entries, days, now]);
  const analysis = useMemo(() => analyze(entries, profile, settings, days, now), [entries, profile, settings, days, now]);
  const shareable = canShareFiles();

  async function make(): Promise<Blob> {
    const { buildReport } = await import('../lib/pdf');
    const doc = buildReport(inPeriod, analysis, profile, settings, opts);
    return doc.output('blob');
  }

  async function run(kind: 'save' | 'share') {
    setBusy(true);
    try {
      const { reportFileName } = await import('../lib/pdf');
      const blob = await make();
      if (kind === 'share') await shareFile(reportFileName(), blob, 'Health measurements report');
      else {
        const how = await saveFile(reportFileName(), blob);
        notify(how === 'downloaded' ? 'Report downloaded' : 'Report ready to save or send');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify(`The report could not be made: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function csv() {
    const blob = new Blob([makeCsv(inPeriod, settings)], { type: 'text/csv' });
    await saveFile(`Vitalis-readings-${new Date().toISOString().slice(0, 10)}.csv`, blob);
  }

  const S = analysis.summaries;
  const card = (label: string, value: string, unit: string, n: number) => (
    <div className="panel panel-pad" key={label}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}<small>{unit}</small></div>
      <div className="hint">{n} {n === 1 ? 'reading' : 'readings'}</div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Report for your doctor</h1>
          <p>A PDF of your readings for an appointment, a second opinion or your own records. Your data stays on this device until you share the file.</p>
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          <div className="panel panel-pad stack">
            <div className="field">
              <span className="field-label">Period</span>
              <div className="chips">
                {PERIODS.map((p) => (
                  <button key={p.label} className="chip" aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Include</span>
              {SECTIONS.map((s) => (
                <label key={s.key} className="check">
                  <input type="checkbox" checked={opts[s.key]} onChange={() => setOpts((o) => ({ ...o, [s.key]: !o[s.key] }))} />
                  <span>
                    <strong>{s.label}</strong>
                    <span className="hint" style={{ display: 'block' }}>{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="row-actions">
              <button className="btn btn-primary" disabled={busy || !inPeriod.length} onClick={() => void run('save')}>
                <Download size={17} /> {busy ? 'Making the PDF...' : 'Download PDF'}
              </button>
              {shareable && (
                <button className="btn" disabled={busy || !inPeriod.length} onClick={() => void run('share')}>
                  <Share2 size={17} /> Share PDF
                </button>
              )}
              <button className="btn btn-ghost" disabled={!inPeriod.length} onClick={() => void csv()}>
                <FileSpreadsheet size={17} /> Export CSV
              </button>
            </div>
            {!inPeriod.length && <p className="hint">There are no readings in this period yet.</p>}
          </div>
        </div>

        <div className="stack">
          <div className="panel panel-pad">
            <h3>Patient details on the report</h3>
            <p className="muted" style={{ marginTop: 6 }}>
              {profile.name || 'No name'}{profile.birthYear ? `, born ${profile.birthYear}` : ''}. {profile.medications ? `Medications: ${profile.medications}.` : 'No medications recorded.'}
            </p>
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => go('settings')}>Edit profile</button>
          </div>
          <div className="report-preview">
            {analysis.present.includes('bp') && card(METRIC_NAME.bp, `${Math.round(S.systolic.mean)}/${Math.round(S.diastolic.mean)}`, 'mmHg', S.systolic.count)}
            {analysis.present.includes('hr') && card(METRIC_NAME.hr, String(Math.round(S.hr.mean)), 'bpm', S.hr.count)}
            {analysis.present.includes('glucose') && card(METRIC_NAME.glucose, formatValue('glucose', S.glucose.mean, settings), unitFor('glucose', settings), S.glucose.count)}
            {analysis.present.includes('uric') && card(METRIC_NAME.uric, formatValue('uric', S.uric.mean, settings), unitFor('uric', settings), S.uric.count)}
          </div>
          <p className="hint">
            Averages for {fmtDate(analysis.from, true)} to {fmtDate(analysis.to, true)}. The report also lists {analysis.insights.length} findings and{' '}
            {settings.customQuestions.length + analysis.questions.filter((q) => !settings.excludedQuestions.includes(q.text)).length} questions.
          </p>
        </div>
      </div>
    </>
  );
}
