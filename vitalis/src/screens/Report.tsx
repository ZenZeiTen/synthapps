import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Share2 } from 'lucide-react';
import { LanguageToggle } from '../components/LanguageToggle';
import { t } from '../i18n';
import { makeCsv } from '../lib/backup';
import { fmtDate, metricName } from '../lib/format';
import { analyze } from '../lib/insights';
import type { ReportOptions } from '../lib/pdf';
import { canShareFiles, saveFile, shareFile } from '../lib/save';
import { DAY, entriesInWindow } from '../lib/stats';
import { formatValue, unitFor } from '../lib/units';
import { useApp } from '../state';

const PERIODS = [30, 90, 180, 365, 0];
const SECTIONS: (keyof ReportOptions)[] = ['summary', 'charts', 'insights', 'questions', 'tests', 'log'];

export function Report() {
  const { entries, profile, settings, lang, notify, go } = useApp();
  const [days, setDays] = useState(90);
  const [opts, setOpts] = useState<ReportOptions>({ summary: true, charts: true, insights: true, questions: true, tests: true, log: true });
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const inPeriod = useMemo(() => entriesInWindow(entries, days ? now - days * DAY : -Infinity, now), [entries, days, now]);
  const analysis = useMemo(() => analyze(entries, profile, settings, days, now), [entries, profile, settings, days, now, lang]);
  const shareable = canShareFiles();
  const T = t().reportPage;

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
      if (kind === 'share') await shareFile(reportFileName(), blob, t().pdf.shareTitle);
      else {
        const how = await saveFile(reportFileName(), blob);
        notify(how === 'downloaded' ? T.downloaded : T.shared);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify(T.failed((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function csv() {
    const blob = new Blob([makeCsv(inPeriod, settings)], { type: 'text/csv' });
    await saveFile(`Vitalis-${new Date().toISOString().slice(0, 10)}.csv`, blob);
  }

  const S = analysis.summaries;
  const card = (label: string, value: string, unit: string, n: number) => (
    <div className="panel panel-pad" key={label}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}<small>{unit}</small></div>
      <div className="hint">{t().common.readings(n)}</div>
    </div>
  );
  const questionCount = settings.customQuestions.length + analysis.questions.filter((q) => !settings.excludedQuestions.includes(q.id)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{T.title}</h1>
          <p>{T.intro}</p>
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          <div className="panel panel-pad stack">
            <div className="field">
              <span className="field-label">{T.period}</span>
              <div className="chips">
                {PERIODS.map((p) => (
                  <button key={p} className="chip" aria-pressed={days === p} onClick={() => setDays(p)}>
                    {T.periods[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">{T.include}</span>
              {SECTIONS.map((key) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={opts[key]} onChange={() => setOpts((o) => ({ ...o, [key]: !o[key] }))} />
                  <span>
                    <strong>{T.sections[key][0]}</strong>
                    <span className="hint" style={{ display: 'block' }}>{T.sections[key][1]}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="field">
              <span className="field-label">{t().common.language}</span>
              <LanguageToggle full />
              <span className="hint">{T.reportLanguage}</span>
            </div>
            <div className="row-actions">
              <button className="btn btn-primary" disabled={busy || !inPeriod.length} onClick={() => void run('save')}>
                <Download size={17} /> {busy ? T.making : T.download}
              </button>
              {shareable && (
                <button className="btn" disabled={busy || !inPeriod.length} onClick={() => void run('share')}>
                  <Share2 size={17} /> {T.share}
                </button>
              )}
              <button className="btn btn-ghost" disabled={!inPeriod.length} onClick={() => void csv()}>
                <FileSpreadsheet size={17} /> {T.csv}
              </button>
            </div>
            {!inPeriod.length && <p className="hint">{T.none}</p>}
          </div>
        </div>

        <div className="stack">
          <div className="panel panel-pad">
            <h3>{T.patient}</h3>
            <p className="muted" style={{ marginTop: 6 }}>
              {profile.name || T.noName}
              {profile.birthYear ? T.born(profile.birthYear) : ''}. {profile.medications ? T.medications(profile.medications) : T.noMedications}
            </p>
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => go('settings')}>{T.editProfile}</button>
          </div>
          <div className="report-preview">
            {analysis.present.includes('bp') && card(metricName('bp'), `${Math.round(S.systolic.mean)}/${Math.round(S.diastolic.mean)}`, 'mmHg', S.systolic.count)}
            {analysis.present.includes('hr') && card(metricName('hr'), String(Math.round(S.hr.mean)), 'bpm', S.hr.count)}
            {analysis.present.includes('glucose') && card(metricName('glucose'), formatValue('glucose', S.glucose.mean, settings), unitFor('glucose', settings), S.glucose.count)}
            {analysis.present.includes('uric') && card(metricName('uric'), formatValue('uric', S.uric.mean, settings), unitFor('uric', settings), S.uric.count)}
          </div>
          <p className="hint">{T.footnote(fmtDate(analysis.from, true), fmtDate(analysis.to, true), analysis.insights.length, questionCount)}</p>
        </div>
      </div>
    </>
  );
}
