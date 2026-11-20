import { useMemo, useState } from 'react';
import { Copy, Phone, Plus, X } from 'lucide-react';
import { Status } from '../components/Visuals';
import { t } from '../i18n';
import { metricName } from '../lib/format';
import { analyze, emergencySigns, type Analysis } from '../lib/insights';
import { useApp } from '../state';

const PERIODS = [30, 90, 365, 0];

export function Insights() {
  const { entries, profile, settings, lang, updateSettings, notify } = useApp();
  const [days, setDays] = useState(30);
  const [draft, setDraft] = useState('');
  const [allLabs, setAllLabs] = useState(false);
  // `lang` is a dependency so the text is rebuilt when the language changes.
  const a: Analysis = useMemo(() => analyze(entries, profile, settings, days), [entries, profile, settings, days, lang]);
  const T = t().insightsPage;
  const scope = t().insights.scope;

  // Suggested questions are remembered by ID, so unticking survives a language switch.
  const included = (id: string) => !settings.excludedQuestions.includes(id);
  const toggle = (id: string) =>
    void updateSettings({
      excludedQuestions: included(id) ? [...settings.excludedQuestions, id] : settings.excludedQuestions.filter((q) => q !== id)
    });

  const addQuestion = () => {
    const text = draft.trim();
    if (!text) return;
    void updateSettings({ customQuestions: [...settings.customQuestions, text] });
    setDraft('');
  };

  const chosen = [...settings.customQuestions, ...a.questions.filter((q) => included(q.id)).map((q) => q.text)];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chosen.map((q, i) => `${i + 1}. ${q}`).join('\n'));
      notify(T.copied(chosen.length));
    } catch {
      notify(T.copyBlocked);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{T.title}</h1>
          <p>{T.intro}</p>
        </div>
        <div className="segmented" role="group" aria-label={t().trends.period}>
          {PERIODS.map((p) => (
            <button key={p} aria-pressed={days === p} onClick={() => setDays(p)}>
              {T.periods[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          <section>
            <div className="section-head"><h2>{T.findings}</h2></div>
            <div className="list">
              {a.insights.map((i) => (
                <div key={i.id} className={`finding lv-${i.level}`}>
                  <span className="finding-mark" />
                  <div>
                    <div className="finding-meta">
                      <span>{scope[i.metric]}</span>
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
              <h2>{T.questions}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy()}><Copy size={15} /> {T.copy}</button>
            </div>
            <p className="hint" style={{ marginBottom: 10 }}>{T.questionsHint}</p>
            <div className="list">
              {settings.customQuestions.map((q, i) => (
                <div key={`c${i}`} className="qrow">
                  <input type="checkbox" checked readOnly aria-label={T.included} />
                  <span style={{ flex: 1 }}>{q}<small>{T.yourQuestion}</small></span>
                  <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label={T.removeQuestion} onClick={() => void updateSettings({ customQuestions: settings.customQuestions.filter((_, j) => j !== i) })}>
                    <X size={16} />
                  </button>
                </div>
              ))}
              {a.questions.map((q) => (
                <label key={q.id} className="qrow" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={included(q.id)} onChange={() => toggle(q.id)} />
                  <span>
                    {q.text}
                    <small>{scope[q.metric]}{q.fromData ? T.fromReadings : ''}</small>
                  </span>
                </label>
              ))}
              <form className="qrow" onSubmit={(e) => { e.preventDefault(); addQuestion(); }}>
                <input className="input" placeholder={T.addQuestion} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, width: 'auto', minHeight: 40 }} aria-label={T.yourQuestion} />
                <button className="btn btn-sm" type="submit" disabled={!draft.trim()}><Plus size={15} /> {T.add}</button>
              </form>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel panel-pad emergency">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Phone size={20} color="var(--lv-urgent)" /> {T.urgentTitle}</h2>
            <p className="muted" style={{ marginTop: 6 }}>{T.urgentIntro}</p>
            <ul>
              {emergencySigns().map((s) => <li key={s}>{s}</li>)}
            </ul>
          </section>

          <section>
            <div className="section-head">
              <h2>{T.tests}</h2>
              {a.labs.some((l) => !l.suggested) && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAllLabs((v) => !v)} aria-expanded={allLabs}>
                  {allLabs ? T.showFewer : T.showAll(a.labs.length)}
                </button>
              )}
            </div>
            {!a.labs.length ? (
              <p className="panel lab muted">{T.noTests}</p>
            ) : (
              <div className="list">
                {a.present.map((m) => {
                  const labs = a.labs.filter((l) => l.metric === m && (allLabs || l.suggested));
                  if (!labs.length) return null;
                  return (
                    <div key={m}>
                      <div className="lab" style={{ paddingBottom: 0 }}>
                        <span className="finding-meta" style={{ margin: 0 }}>{metricName(m)}</span>
                      </div>
                      {labs.map((l) => (
                        <div key={l.id} className="lab">
                          <div className="lab-name">
                            <span>{l.name}</span>
                            {l.suggested && <span className="tag-suggested">{T.worthAsking}</span>}
                          </div>
                          <p>{l.why}</p>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {!allLabs && !a.labs.some((l) => l.suggested) && <p className="lab muted">{T.noSuggestedTests}</p>}
              </div>
            )}
          </section>

          <section>
            <div className="section-head"><h2>{T.doctors}</h2></div>
            <div className="list">
              {a.specialists.map((s) => (
                <div key={s.id} className="lab">
                  <div className="lab-name">
                    <span>{s.who}</span>
                    {s.suggested && <span className="tag-suggested">{T.suggestedNow}</span>}
                  </div>
                  <p>{s.when}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <p className="disclaimer">{T.disclaimer}</p>
    </>
  );
}
