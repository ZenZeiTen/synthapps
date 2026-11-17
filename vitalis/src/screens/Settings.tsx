import { useEffect, useRef, useState } from 'react';
import { Download, Smartphone, Upload } from 'lucide-react';
import { makeBackup, parseBackup } from '../lib/backup';
import { requestPersistence } from '../lib/db';
import { sampleEntries } from '../lib/sample';
import { saveFile } from '../lib/save';
import type { Profile, Sex } from '../lib/types';
import { useApp } from '../state';
import { useInstallPrompt } from '../pwa';

function numOrUndef(s: string): number | undefined {
  const n = Number(s);
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
}

export function Settings() {
  const { profile, settings, entries, updateProfile, updateSettings, addEntries, clearAll, notify } = useApp();
  const [p, setP] = useState<Profile>(profile);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const install = useInstallPrompt();

  useEffect(() => setP(profile), [profile]);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const dirty = JSON.stringify(p) !== JSON.stringify(profile);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const setTarget = (k: keyof Profile['targets'], v: string) => setP((x) => ({ ...x, targets: { ...x.targets, [k]: numOrUndef(v) } }));

  async function backup() {
    const blob = new Blob([makeBackup(entries, profile, settings)], { type: 'application/json' });
    await saveFile(`Vitalis-backup-${new Date().toISOString().slice(0, 10)}.json`, blob);
    notify('Backup saved');
  }

  async function restore(file: File) {
    try {
      const { entries: es, profile: bp, skipped } = parseBackup(await file.text());
      await addEntries(es);
      if (bp && !profile.name && confirm('Also restore the profile from the backup?')) await updateProfile({ ...profile, ...bp });
      notify(`Restored ${es.length} readings${skipped ? `, skipped ${skipped} that could not be read` : ''}`);
    } catch (e) {
      notify((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your profile tunes the ranges used for insights and appears on your report. Everything is stored only on this device.</p>
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          <section className="panel panel-pad stack">
            <h2>Profile</h2>
            <div className="form-grid two">
              <label className="field">
                <span>Name</span>
                <input className="input" value={p.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              </label>
              <label className="field">
                <span>Year of birth</span>
                <input className="input" inputMode="numeric" value={p.birthYear ?? ''} onChange={(e) => set('birthYear', numOrUndef(e.target.value.replace(/\D/g, '').slice(0, 4)))} />
              </label>
              <label className="field">
                <span>Sex</span>
                <select className="select" value={p.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
                  <option value="unspecified">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
                <span className="hint">Used for the uric acid range.</span>
              </label>
              <label className="field">
                <span>Doctor</span>
                <input className="input" value={p.doctorName} onChange={(e) => set('doctorName', e.target.value)} placeholder="Name and clinic" />
              </label>
            </div>
            <div className="field">
              <span className="field-label">Diagnosed conditions</span>
              <label className="check"><input type="checkbox" checked={p.hasHypertension} onChange={(e) => set('hasHypertension', e.target.checked)} /> <span>High blood pressure</span></label>
              <label className="check"><input type="checkbox" checked={p.hasDiabetes} onChange={(e) => set('hasDiabetes', e.target.checked)} /> <span>Diabetes <span className="hint" style={{ display: 'block' }}>Glucose is compared with treatment targets instead of diagnostic ranges.</span></span></label>
              <label className="check"><input type="checkbox" checked={p.hasGout} onChange={(e) => set('hasGout', e.target.checked)} /> <span>Gout <span className="hint" style={{ display: 'block' }}>Uric acid is compared with the treatment target of below 6 mg/dL.</span></span></label>
            </div>
            <label className="field">
              <span>Medications and doses</span>
              <textarea className="textarea" value={p.medications} onChange={(e) => set('medications', e.target.value)} placeholder="For example: amlodipine 5 mg in the morning" />
            </label>
          </section>

          <section className="panel panel-pad stack">
            <div>
              <h2>Targets from your doctor</h2>
              <p className="muted" style={{ marginTop: 6 }}>Optional. Leave blank to use general ranges. Glucose and uric acid targets are in mg/dL.</p>
            </div>
            <div className="form-grid two">
              <label className="field"><span>Blood pressure: keep systolic below</span><input className="input" inputMode="numeric" value={p.targets.bpSystolicMax ?? ''} onChange={(e) => setTarget('bpSystolicMax', e.target.value)} placeholder="130" /></label>
              <label className="field"><span>Blood pressure: keep diastolic below</span><input className="input" inputMode="numeric" value={p.targets.bpDiastolicMax ?? ''} onChange={(e) => setTarget('bpDiastolicMax', e.target.value)} placeholder="80" /></label>
              <label className="field"><span>Fasting glucose from</span><input className="input" inputMode="numeric" value={p.targets.glucoseFastingMin ?? ''} onChange={(e) => setTarget('glucoseFastingMin', e.target.value)} placeholder="80" /></label>
              <label className="field"><span>Fasting glucose up to</span><input className="input" inputMode="numeric" value={p.targets.glucoseFastingMax ?? ''} onChange={(e) => setTarget('glucoseFastingMax', e.target.value)} placeholder="130" /></label>
              <label className="field"><span>After-meal glucose below</span><input className="input" inputMode="numeric" value={p.targets.glucoseAfterMealMax ?? ''} onChange={(e) => setTarget('glucoseAfterMealMax', e.target.value)} placeholder="180" /></label>
              <label className="field"><span>Uric acid below</span><input className="input" inputMode="decimal" value={p.targets.uricMax ?? ''} onChange={(e) => setTarget('uricMax', e.target.value)} placeholder="6.0" /></label>
            </div>
            <p className="hint">Glucose targets apply when Diabetes is ticked.</p>
          </section>

          {dirty && (
            <div style={{ position: 'sticky', bottom: 'calc(96px + var(--safe-bottom))', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn" onClick={() => setP(profile)}>Discard</button>
              <button className="btn btn-primary" onClick={() => { void updateProfile(p).then(() => notify('Profile saved')); }}>Save profile</button>
            </div>
          )}
        </div>

        <div className="stack">
          <section className="list">
            <div className="settings-row">
              <div><strong>Glucose unit</strong><p>mg/dL is used in Indonesia and the US; mmol/L in the UK, Europe and Australia.</p></div>
              <div className="segmented">
                {(['mg/dL', 'mmol/L'] as const).map((u) => <button key={u} aria-pressed={settings.glucoseUnit === u} onClick={() => void updateSettings({ glucoseUnit: u })}>{u}</button>)}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>Uric acid unit</strong></div>
              <div className="segmented">
                {(['mg/dL', 'µmol/L'] as const).map((u) => <button key={u} aria-pressed={settings.uricUnit === u} onClick={() => void updateSettings({ uricUnit: u })}>{u}</button>)}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>Appearance</strong></div>
              <div className="segmented">
                {(['system', 'light', 'dark'] as const).map((t) => <button key={t} aria-pressed={settings.theme === t} onClick={() => void updateSettings({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}
              </div>
            </div>
          </section>

          {install.available && (
            <section className="panel panel-pad">
              <h3>Install Vitalis</h3>
              <p className="muted" style={{ margin: '6px 0 12px' }}>Add it to your home screen. It opens full screen and works without internet.</p>
              <button className="btn btn-primary" onClick={() => void install.prompt()}><Smartphone size={17} /> Install app</button>
            </section>
          )}

          <section className="panel panel-pad stack">
            <div>
              <h2>Your data</h2>
              <p className="muted" style={{ marginTop: 6 }}>
                {entries.length} readings, stored in this browser only.{' '}
                {persisted === false && 'The browser may clear them if storage runs low, so keep a backup.'}
              </p>
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => void backup()}><Download size={16} /> Back up data</button>
              <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} /> Restore a backup</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} />
              {persisted === false && (
                <button className="btn btn-ghost" onClick={() => void requestPersistence().then((ok) => { setPersisted(ok); notify(ok ? 'Storage is now protected' : 'The browser did not allow it. Installing the app usually helps.'); })}>
                  Protect storage
                </button>
              )}
            </div>
            <div className="row-actions">
              <button className="btn btn-ghost" onClick={() => void addEntries(sampleEntries()).then(() => notify('Added 60 days of sample readings'))}>Add sample readings</button>
              <button
                className="btn btn-ghost btn-danger"
                disabled={!entries.length}
                onClick={() => {
                  if (confirm(`Delete all ${entries.length} readings from this device? This cannot be undone. Back up first if you may need them.`)) {
                    void clearAll().then(() => notify('All readings deleted'));
                  }
                }}
              >
                Delete all readings
              </button>
            </div>
          </section>

          <section className="panel panel-pad">
            <h3>About</h3>
            <p className="muted" style={{ marginTop: 6 }}>
              Vitalis is a personal record, not a medical device. It does not diagnose, treat or replace advice from a doctor, and it cannot detect an emergency. Ranges follow the ACC/AHA blood pressure categories, ADA glucose standards, typical laboratory uric acid ranges and the ACR gout target.
            </p>
            <p className="hint" style={{ marginTop: 10 }}>Version {__APP_VERSION__}</p>
          </section>
        </div>
      </div>
    </>
  );
}
