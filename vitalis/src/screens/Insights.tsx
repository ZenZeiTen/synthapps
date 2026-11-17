import { useMemo, useState } from 'react';
import { Copy, Phone, Plus, X } from 'lucide-react';
import { Status } from '../components/Visuals';
import { METRIC_NAME } from '../lib/format';
import { analyze, EMERGENCY_SIGNS, type Analysis } from '../lib/insights';
import { useApp } from '../state';

export const INSIGHT_PERIODS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
  { days: 0, label: 'All' }
];

const SCOPE: Record<string, string> = { ...METRIC_NAME, general: 'General' };

export function Insights() {
  const { entries, profile, settings, updateSettings, notify } = useApp();
  const [days, setDays] = useState(30);
  const [draft, setDraft] = useState('');
  const [allLabs, setAllLabs] = useState(false);
  const a: Analysis = useMemo(() => analyze(entries, profile, settings, days), [entries, profile, settings, days]);

  const included = (text: string) => !settings.excludedQuestions.includes(text);
  const toggle = (text: string) =>
    void updateSettings({
      excludedQuestions: included(text) ? [...settings.excludedQuestions, text] : settings.excludedQuestions.filter((q) => q !== text)
    });

  const addQuestion = () => {
    const t = draft.trim();
    if (!t) return;
    void updateSettings({ customQuestions: [...settings.customQuestions, t] });
    setDraft('');
  };

  const chosen = [...settings.customQuestions, ...a.questions.map((q) => q.text).filter(included)];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chosen.map((q, i) => `${i + 1}. ${q}`).join('\n'));
      notify(`Copied ${chosen.length} questions`);
    } catch {
      notify('Copying is blocked here. Use the report instead.');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <p>What your readings suggest, what to ask, which tests to consider and who to see. This is general information to discuss with a clinician, not a diagnosis.</p>
        </div>
        <div className="segmented" role="group" aria-label="Period">
          {INSIGHT_PERIODS.map((p) => (
            <button key={p.label} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          <section>
            <div className="section-head"><h2>Findings</h2></div>
            <div className="list">
              {a.insights.map((i) => (
                <div key={i.id} className={`finding lv-${i.level}`}>
                  <span className="finding-mark" />
                  <div>
                    <div className="finding-meta">
                      <span>{SCOPE[i.metric]}</span>
                      {i.level !== 'neutral' && <Status level={i.level} />}
                    </div>
                    <h3>{i.title}</h3>
                  </div>
                  <p>{i.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="section" style={{ marginTop: 22 }}>
            <div className="section-head">
              <h2>Questions for your doctor</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy()}><Copy size={15} /> Copy</button>
            </div>
            <p className="hint" style={{ marginBottom: 10 }}>Ticked questions go into your PDF report. Questions marked "from your readings" were raised by your own numbers.</p>
            <div className="list">
              {settings.customQuestions.map((q, i) => (
                <div key={`c${i}`} className="qrow">
                  <input type="checkbox" checked readOnly aria-label="Included" />
                  <span style={{ flex: 1 }}>{q}<small>Your question</small></span>
                  <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Remove question" onClick={() => void updateSettings({ customQuestions: settings.customQuestions.filter((_, j) => j !== i) })}>
                    <X size={16} />
                  </button>
                </div>
              ))}
              {a.questions.map((q) => (
                <label key={q.text} className="qrow" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={included(q.text)} onChange={() => toggle(q.text)} />
                  <span>
                    {q.text}
                    <small>{SCOPE[q.metric]}{q.fromData ? ', from your readings' : ''}</small>
                  </span>
                </label>
              ))}
              <form className="qrow" onSubmit={(e) => { e.preventDefault(); addQuestion(); }}>
                <input className="input" placeholder="Add your own question" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, width: 'auto', minHeight: 40 }} aria-label="Your question" />
                <button className="btn btn-sm" type="submit" disabled={!draft.trim()}><Plus size={15} /> Add</button>
              </form>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel panel-pad emergency">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Phone size={20} color="var(--lv-urgent)" /> When to get urgent care</h2>
            <p className="muted" style={{ marginTop: 6 }}>Call your local emergency number (112 in Indonesia, Europe and many other countries; 911 in North America) or go to an emergency department if you have:</p>
            <ul>
              {EMERGENCY_SIGNS.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </section>

          <section>
            <div className="section-head">
              <h2>Tests to ask about</h2>
              {a.labs.some((l) => !l.suggested) && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAllLabs((v) => !v)} aria-expanded={allLabs}>
                  {allLabs ? 'Show fewer' : `Show all ${a.labs.length}`}
                </button>
              )}
            </div>
            {!a.labs.length ? (
              <p className="panel lab muted">Log readings to see which tests relate to them.</p>
            ) : (
              <div className="list">
                {a.present.map((m) => {
                  const labs = a.labs.filter((l) => l.metric === m && (allLabs || l.suggested));
                  if (!labs.length) return null;
                  return (
                    <div key={m}>
                      <div className="lab" style={{ paddingBottom: 0 }}>
                        <span className="finding-meta" style={{ margin: 0 }}>{METRIC_NAME[m]}</span>
                      </div>
                      {labs.map((l) => (
                        <div key={l.name} className="lab">
                          <div className="lab-name">
                            <span>{l.name}</span>
                            {l.suggested && <span className="tag-suggested">Worth asking about</span>}
                          </div>
                          <p>{l.why}</p>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {!allLabs && !a.labs.some((l) => l.suggested) && (
                  <p className="lab muted">None of your readings point to a particular test. Choose "Show all" to see the tests usually linked to these measurements.</p>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="section-head"><h2>Which doctor to see</h2></div>
            <div className="list">
              {a.specialists.map((s) => (
                <div key={s.who} className="lab">
                  <div className="lab-name">
                    <span>{s.who}</span>
                    {s.suggested && <span className="tag-suggested">Suggested now</span>}
                  </div>
                  <p>{s.when}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <p className="disclaimer">
        Vitalis compares readings with published adult reference ranges (ACC/AHA blood pressure categories, ADA glucose criteria and targets, common uric acid laboratory ranges and the ACR gout target). Home devices vary in accuracy, and ranges differ by age, pregnancy, medical history and laboratory. Only a qualified clinician can diagnose a condition or change treatment.
      </p>
    </>
  );
}
