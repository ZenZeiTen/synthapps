import { useEffect, useRef, useState } from 'react';
import { Download, Smartphone, Upload } from 'lucide-react';
import { LanguageToggle } from '../components/LanguageToggle';
import { num, t } from '../i18n';
import { makeBackup, parseBackup } from '../lib/backup';
import { requestPersistence } from '../lib/db';
import { sampleEntries } from '../lib/sample';
import { saveFile } from '../lib/save';
import type { Profile, Sex } from '../lib/types';
import { useApp } from '../state';
import { useInstallPrompt } from '../pwa';

/** Reads a typed number, accepting a decimal comma as well as a point. */
function numOrUndef(s: string): number | undefined {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
}

export function Settings() {
  const { profile, settings, entries, updateProfile, updateSettings, addEntries, clearAll, notify } = useApp();
  const [p, setP] = useState<Profile>(profile);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const install = useInstallPrompt();
  const T = t().settingsPage;

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
    notify(T.backupSaved);
  }

  async function restore(file: File) {
    try {
      const { entries: es, profile: bp, skipped } = parseBackup(await file.text());
      await addEntries(es);
      if (bp && !profile.name && confirm(T.restoreProfile)) await updateProfile({ ...profile, ...bp });
      notify(T.restored(es.length, skipped));
    } catch (e) {
      notify((e as Error).message);
    }
  }

  const target = (k: keyof Profile['targets'], label: string, placeholder: string, decimal = false) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" inputMode={decimal ? 'decimal' : 'numeric'} value={p.targets[k] ?? ''} onChange={(e) => setTarget(k, e.target.value)} placeholder={placeholder} />
    </label>
  );

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
          <section className="panel panel-pad stack">
            <h2>{T.profile}</h2>
            <div className="form-grid two">
              <label className="field">
                <span>{T.name}</span>
                <input className="input" value={p.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              </label>
              <label className="field">
                <span>{T.birthYear}</span>
                <input className="input" inputMode="numeric" value={p.birthYear ?? ''} onChange={(e) => set('birthYear', numOrUndef(e.target.value.replace(/\D/g, '').slice(0, 4)))} />
              </label>
              <label className="field">
                <span>{T.sex}</span>
                <select className="select" value={p.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
                  <option value="unspecified">{T.sexOptions.unspecified}</option>
                  <option value="female">{T.sexOptions.female}</option>
                  <option value="male">{T.sexOptions.male}</option>
                </select>
                <span className="hint">{T.sexHint}</span>
              </label>
              <label className="field">
                <span>{T.doctor}</span>
                <input className="input" value={p.doctorName} onChange={(e) => set('doctorName', e.target.value)} placeholder={T.doctorPlaceholder} />
              </label>
            </div>
            <div className="field">
              <span className="field-label">{T.conditions}</span>
              <label className="check"><input type="checkbox" checked={p.hasHypertension} onChange={(e) => set('hasHypertension', e.target.checked)} /> <span>{T.hypertension}</span></label>
              <label className="check"><input type="checkbox" checked={p.hasDiabetes} onChange={(e) => set('hasDiabetes', e.target.checked)} /> <span>{T.diabetes} <span className="hint" style={{ display: 'block' }}>{T.diabetesHint}</span></span></label>
              <label className="check"><input type="checkbox" checked={p.hasGout} onChange={(e) => set('hasGout', e.target.checked)} /> <span>{T.gout} <span className="hint" style={{ display: 'block' }}>{T.goutHint}</span></span></label>
            </div>
            <label className="field">
              <span>{T.medications}</span>
              <textarea className="textarea" value={p.medications} onChange={(e) => set('medications', e.target.value)} placeholder={T.medicationsPlaceholder} />
            </label>
          </section>

          <section className="panel panel-pad stack">
            <div>
              <h2>{T.targets}</h2>
              <p className="muted" style={{ marginTop: 6 }}>{T.targetsIntro}</p>
            </div>
            <div className="form-grid two">
              {target('bpSystolicMax', T.tSys, '130')}
              {target('bpDiastolicMax', T.tDia, '80')}
              {target('glucoseFastingMin', T.tFastMin, '80')}
              {target('glucoseFastingMax', T.tFastMax, '130')}
              {target('glucoseAfterMealMax', T.tAfter, '180')}
              {target('uricMax', T.tUric, num(6, 1), true)}
            </div>
            <p className="hint">{T.targetsHint}</p>
          </section>

          {dirty && (
            <div style={{ position: 'sticky', bottom: 'calc(96px + var(--safe-bottom))', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn" onClick={() => setP(profile)}>{T.discard}</button>
              <button className="btn btn-primary" onClick={() => { void updateProfile(p).then(() => notify(T.profileSaved)); }}>{T.saveProfile}</button>
            </div>
          )}
        </div>

        <div className="stack">
          <section className="list">
            <div className="settings-row">
              <div><strong>{T.language}</strong><p>{T.languageHint}</p></div>
              <LanguageToggle full />
            </div>
            <div className="settings-row">
              <div><strong>{T.glucoseUnit}</strong><p>{T.glucoseUnitHint}</p></div>
              <div className="segmented">
                {(['mg/dL', 'mmol/L'] as const).map((u) => <button key={u} aria-pressed={settings.glucoseUnit === u} onClick={() => void updateSettings({ glucoseUnit: u })}>{u}</button>)}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>{T.uricUnit}</strong></div>
              <div className="segmented">
                {(['mg/dL', 'µmol/L'] as const).map((u) => <button key={u} aria-pressed={settings.uricUnit === u} onClick={() => void updateSettings({ uricUnit: u })}>{u}</button>)}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>{T.appearance}</strong></div>
              <div className="segmented">
                {(['system', 'light', 'dark'] as const).map((th) => <button key={th} aria-pressed={settings.theme === th} onClick={() => void updateSettings({ theme: th })}>{T.themes[th]}</button>)}
              </div>
            </div>
          </section>

          {install.available && (
            <section className="panel panel-pad">
              <h3>{T.install}</h3>
              <p className="muted" style={{ margin: '6px 0 12px' }}>{T.installBody}</p>
              <button className="btn btn-primary" onClick={() => void install.prompt()}><Smartphone size={17} /> {T.installButton}</button>
            </section>
          )}

          <section className="panel panel-pad stack">
            <div>
              <h2>{T.data}</h2>
              <p className="muted" style={{ marginTop: 6 }}>
                {T.dataSummary(entries.length)} {persisted === false && T.mayClear}
              </p>
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => void backup()}><Download size={16} /> {T.backup}</button>
              <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} /> {T.restore}</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} />
              {persisted === false && (
                <button className="btn btn-ghost" onClick={() => void requestPersistence().then((ok) => { setPersisted(ok); notify(ok ? T.protected : T.protectDenied); })}>
                  {T.protect}
                </button>
              )}
            </div>
            <div className="row-actions">
              <button className="btn btn-ghost" onClick={() => void addEntries(sampleEntries()).then(() => notify(T.sampleAdded))}>{T.addSample}</button>
              <button
                className="btn btn-ghost btn-danger"
                disabled={!entries.length}
                onClick={() => {
                  if (confirm(T.deleteConfirm(entries.length))) void clearAll().then(() => notify(T.deleted));
                }}
              >
                {T.deleteAll}
              </button>
            </div>
          </section>

          <section className="panel panel-pad">
            <h3>{T.about}</h3>
            <p className="muted" style={{ marginTop: 6 }}>{T.aboutBody}</p>
            <p className="hint" style={{ marginTop: 10 }}>{T.version(__APP_VERSION__)}</p>
          </section>
        </div>
      </div>
    </>
  );
}
