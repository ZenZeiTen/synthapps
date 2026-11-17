import { useState } from 'react';
import { LanguageToggle } from '../components/LanguageToggle';
import { Logo } from '../components/Visuals';
import { t } from '../i18n';
import { sampleEntries } from '../lib/sample';
import type { Sex } from '../lib/types';
import { useApp } from '../state';

export function Welcome() {
  const { profile, updateProfile, updateSettings, addEntries } = useApp();
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [cond, setCond] = useState({ hasHypertension: profile.hasHypertension, hasDiabetes: profile.hasDiabetes, hasGout: profile.hasGout });
  const [ok, setOk] = useState(false);
  const W = t().welcome;
  const S = t().settingsPage;

  async function start(withSample: boolean) {
    await updateProfile({ ...profile, sex, ...cond });
    if (withSample) await addEntries(sampleEntries());
    await updateSettings({ acknowledged: true });
  }

  return (
    <main className="main" style={{ paddingBottom: 48 }}>
      <div className="welcome" style={{ margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 28 }}>
          <div className="wordmark">
            <Logo /> Vitalis
          </div>
          <LanguageToggle />
        </div>
        <h1 style={{ fontSize: 'clamp(34px, 6vw, 52px)', maxWidth: '17ch' }}>{W.headline}</h1>
        <svg className="welcome-art" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
          <path
            className="draw"
            style={{ ['--len' as string]: 1400 }}
            d="M0 74 H120 l14 -10 l12 10 H190 l10 -46 l16 82 l14 -50 l10 14 H330 l14 -10 l12 10 H400 l10 -46 l16 82 l14 -50 l10 14 H600"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <p style={{ fontSize: 17, color: 'var(--ink-2)', maxWidth: '58ch' }}>
          {W.body}
        </p>

        <div className="panel panel-pad stack" style={{ marginTop: 28 }}>
          <h2>{W.quick}</h2>
          <div className="field">
            <span className="field-label">{W.sex}</span>
            <div className="chips">
              {(['female', 'male', 'unspecified'] as Sex[]).map((s) => (
                <button key={s} className="chip" aria-pressed={sex === s} onClick={() => setSex(s)}>
                  {S.sexOptions[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">{W.diagnosed}</span>
            <div className="chips">
              <button className="chip" aria-pressed={cond.hasHypertension} onClick={() => setCond((c) => ({ ...c, hasHypertension: !c.hasHypertension }))}>{S.hypertension}</button>
              <button className="chip" aria-pressed={cond.hasDiabetes} onClick={() => setCond((c) => ({ ...c, hasDiabetes: !c.hasDiabetes }))}>{S.diabetes}</button>
              <button className="chip" aria-pressed={cond.hasGout} onClick={() => setCond((c) => ({ ...c, hasGout: !c.hasGout }))}>{S.gout}</button>
            </div>
            <span className="hint">{W.diagnosedHint}</span>
          </div>
          <label className="check" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>
              {W.ack}
            </span>
          </label>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={!ok} onClick={() => void start(false)}>{W.start}</button>
            <button className="btn" disabled={!ok} onClick={() => void start(true)}>{W.sample}</button>
          </div>
        </div>
      </div>
    </main>
  );
}
