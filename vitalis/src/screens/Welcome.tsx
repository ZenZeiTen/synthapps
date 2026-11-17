import { useState } from 'react';
import { Logo } from '../components/Visuals';
import { sampleEntries } from '../lib/sample';
import type { Sex } from '../lib/types';
import { useApp } from '../state';

export function Welcome() {
  const { profile, updateProfile, updateSettings, addEntries } = useApp();
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [cond, setCond] = useState({ hasHypertension: profile.hasHypertension, hasDiabetes: profile.hasDiabetes, hasGout: profile.hasGout });
  const [ok, setOk] = useState(false);

  async function start(withSample: boolean) {
    await updateProfile({ ...profile, sex, ...cond });
    if (withSample) await addEntries(sampleEntries());
    await updateSettings({ acknowledged: true });
  }

  return (
    <main className="main" style={{ paddingBottom: 48 }}>
      <div className="welcome" style={{ margin: '0 auto' }}>
        <div className="wordmark" style={{ marginBottom: 28 }}>
          <Logo /> Vitalis
        </div>
        <h1 style={{ fontSize: 'clamp(34px, 6vw, 52px)', maxWidth: '14ch' }}>Your vital signs, on one clear page.</h1>
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
          Record blood pressure, heart rate, blood glucose and uric acid in a few taps. See where each reading falls, how it changes over weeks, and what is worth raising with your doctor. Your readings stay on this device.
        </p>

        <div className="panel panel-pad stack" style={{ marginTop: 28 }}>
          <h2>Two quick questions</h2>
          <div className="field">
            <span className="field-label">Sex (used for the uric acid range)</span>
            <div className="chips">
              {(['female', 'male', 'unspecified'] as Sex[]).map((s) => (
                <button key={s} className="chip" aria-pressed={sex === s} onClick={() => setSex(s)}>
                  {s === 'unspecified' ? 'Prefer not to say' : s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Has a doctor diagnosed any of these?</span>
            <div className="chips">
              <button className="chip" aria-pressed={cond.hasHypertension} onClick={() => setCond((c) => ({ ...c, hasHypertension: !c.hasHypertension }))}>High blood pressure</button>
              <button className="chip" aria-pressed={cond.hasDiabetes} onClick={() => setCond((c) => ({ ...c, hasDiabetes: !c.hasDiabetes }))}>Diabetes</button>
              <button className="chip" aria-pressed={cond.hasGout} onClick={() => setCond((c) => ({ ...c, hasGout: !c.hasGout }))}>Gout</button>
            </div>
            <span className="hint">This switches glucose and uric acid to treatment targets. You can change it later in Settings.</span>
          </div>
          <label className="check" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>
              I understand that Vitalis is a personal record, not medical advice. It does not diagnose conditions or detect emergencies, and I will talk to a doctor about my readings.
            </span>
          </label>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={!ok} onClick={() => void start(false)}>Start tracking</button>
            <button className="btn" disabled={!ok} onClick={() => void start(true)}>Explore with sample readings</button>
          </div>
        </div>
      </div>
    </main>
  );
}
