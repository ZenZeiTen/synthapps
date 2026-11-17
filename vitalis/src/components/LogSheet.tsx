import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { newId } from '../lib/db';
import { HR_CONTEXT_LABEL, METRIC_NAME } from '../lib/format';
import { IRREGULAR_TAG } from '../lib/insights';
import {
  diastolicBands,
  GLUCOSE_CONTEXT_LABEL,
  glucoseBands,
  gradeEntry,
  hrBands,
  systolicBands,
  uricBands
} from '../lib/ranges';
import { nowLocalISO } from '../lib/stats';
import type { BpArm, BpPosition, Entry, GlucoseContext, GlucoseUnit, HrContext, Metric, UricUnit } from '../lib/types';
import { decimalsFor, glucoseFromCanonical, glucoseToCanonical, uricFromCanonical, uricToCanonical } from '../lib/units';
import { useApp } from '../state';
import { RangeRuler, Status } from './Visuals';

const TAGS = ['Took medication', 'Missed medication', 'Coffee', 'Exercise', 'Stressed', 'Poor sleep', 'Salty meal', 'Alcohol', 'Unwell', 'Pain', IRREGULAR_TAG];

const LIMITS = {
  systolic: [50, 300],
  diastolic: [25, 200],
  pulse: [20, 250],
  hr: [20, 250],
  glucose: [10, 800], // mg/dL
  uric: [0.5, 20] // mg/dL
} as const;

function defaultGlucoseContext(): GlucoseContext {
  const h = new Date().getHours();
  if (h >= 4 && h < 10) return 'fasting';
  if (h >= 21 || h < 4) return 'bedtime';
  return 'random';
}

export function LogSheet() {
  const { logRequest, closeLog, saveEntry, removeEntry, settings, profile, notify, updateSettings } = useApp();
  const editing = logRequest?.entry;
  const [metric, setMetric] = useState<Metric>(editing?.metric ?? logRequest?.metric ?? 'bp');
  const [takenAt, setTakenAt] = useState(editing?.takenAt ?? nowLocalISO());
  const [sys, setSys] = useState(editing?.systolic?.toString() ?? '');
  const [dia, setDia] = useState(editing?.diastolic?.toString() ?? '');
  const [pulse, setPulse] = useState(editing?.pulse?.toString() ?? '');
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>(settings.glucoseUnit);
  const [uricUnit, setUricUnit] = useState<UricUnit>(settings.uricUnit);
  const initialValue = () => {
    if (!editing || editing.value === undefined) return '';
    if (editing.metric === 'glucose') return glucoseFromCanonical(editing.value, settings.glucoseUnit).toFixed(decimalsFor('glucose', settings));
    if (editing.metric === 'uric') return uricFromCanonical(editing.value, settings.uricUnit).toFixed(decimalsFor('uric', settings));
    return String(editing.value);
  };
  const [value, setValue] = useState(initialValue);
  const [gctx, setGctx] = useState<GlucoseContext>(editing?.glucoseContext ?? defaultGlucoseContext());
  const [hctx, setHctx] = useState<HrContext>(editing?.hrContext ?? 'resting');
  const [position, setPosition] = useState<BpPosition | undefined>(editing?.position ?? 'sitting');
  const [arm, setArm] = useState<BpArm | undefined>(editing?.arm);
  const [tags, setTags] = useState<string[]>(editing?.tags ?? []);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [error, setError] = useState('');
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInput.current?.focus({ preventScroll: true });
  }, [metric]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLog();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [closeLog]);

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

  /** The entry as typed so far, in canonical units, or null if incomplete. */
  const draft = useMemo((): Entry | null => {
    const base = {
      id: editing?.id ?? 'draft',
      metric,
      takenAt,
      tags,
      notes,
      createdAt: editing?.createdAt ?? '',
      updatedAt: ''
    };
    if (metric === 'bp') {
      const s = num(sys);
      const d = num(dia);
      if (s === undefined || d === undefined || Number.isNaN(s) || Number.isNaN(d)) return null;
      const p = num(pulse);
      return { ...base, systolic: s, diastolic: d, pulse: p !== undefined && !Number.isNaN(p) ? p : undefined, position, arm };
    }
    const v = num(value);
    if (v === undefined || Number.isNaN(v)) return null;
    if (metric === 'hr') return { ...base, value: v, hrContext: hctx };
    if (metric === 'glucose') return { ...base, value: glucoseToCanonical(v, glucoseUnit), enteredUnit: glucoseUnit, glucoseContext: gctx };
    return { ...base, value: uricToCanonical(v, uricUnit), enteredUnit: uricUnit };
  }, [metric, takenAt, tags, notes, sys, dia, pulse, position, arm, value, hctx, gctx, glucoseUnit, uricUnit, editing]);

  const grade = draft ? gradeEntry(draft, profile) : null;

  function validate(e: Entry): string {
    const out = (v: number | undefined, [lo, hi]: readonly [number, number]) => v === undefined || v < lo || v > hi;
    if (e.metric === 'bp') {
      if (out(e.systolic, LIMITS.systolic)) return `Systolic (top number) should be between ${LIMITS.systolic[0]} and ${LIMITS.systolic[1]} mmHg.`;
      if (out(e.diastolic, LIMITS.diastolic)) return `Diastolic (bottom number) should be between ${LIMITS.diastolic[0]} and ${LIMITS.diastolic[1]} mmHg.`;
      if ((e.systolic ?? 0) <= (e.diastolic ?? 0)) return 'The top number (systolic) is normally higher than the bottom number (diastolic). Check the order.';
      if (e.pulse !== undefined && out(e.pulse, LIMITS.pulse)) return `Pulse should be between ${LIMITS.pulse[0]} and ${LIMITS.pulse[1]} bpm.`;
    }
    if (e.metric === 'hr' && out(e.value, LIMITS.hr)) return `Heart rate should be between ${LIMITS.hr[0]} and ${LIMITS.hr[1]} bpm.`;
    if (e.metric === 'glucose' && out(e.value, LIMITS.glucose)) {
      return glucoseUnit === 'mmol/L' ? 'Glucose should be between 0.6 and 44 mmol/L. Check the unit.' : 'Glucose should be between 10 and 800 mg/dL. Check the unit.';
    }
    if (e.metric === 'uric' && out(e.value, LIMITS.uric)) {
      return uricUnit === 'µmol/L' ? 'Uric acid should be between 30 and 1190 µmol/L. Check the unit.' : 'Uric acid should be between 0.5 and 20 mg/dL. Check the unit.';
    }
    if (Number.isNaN(new Date(e.takenAt).getTime())) return 'Choose a date and time.';
    if (new Date(e.takenAt).getTime() > Date.now() + 5 * 60_000) return 'The date and time are in the future.';
    return '';
  }

  async function save() {
    if (!draft) {
      setError(metric === 'bp' ? 'Enter both numbers from your monitor.' : 'Enter the reading.');
      return;
    }
    const msg = validate(draft);
    if (msg) {
      setError(msg);
      return;
    }
    const stamp = new Date().toISOString();
    const entry: Entry = { ...draft, id: editing?.id ?? newId(), createdAt: editing?.createdAt || stamp, updatedAt: stamp };
    await saveEntry(entry);
    if (metric === 'glucose' && glucoseUnit !== settings.glucoseUnit) await updateSettings({ glucoseUnit });
    if (metric === 'uric' && uricUnit !== settings.uricUnit) await updateSettings({ uricUnit });
    closeLog();
    notify(editing ? 'Reading updated' : grade?.level === 'urgent' ? 'Reading saved. See the advice on Today.' : 'Reading saved');
  }

  const toggleTag = (t: string) => setTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));

  const rulerFor = () => {
    if (!draft) return null;
    if (metric === 'bp') {
      return (
        <>
          <RangeRuler label="Systolic" bands={systolicBands(profile)} value={draft.systolic} min={80} max={200} />
          <RangeRuler label="Diastolic" bands={diastolicBands(profile)} value={draft.diastolic} min={50} max={130} />
        </>
      );
    }
    if (metric === 'hr') return hctx === 'active' || hctx === 'after-exercise' ? null : <RangeRuler bands={hrBands()} value={draft.value} min={30} max={150} />;
    if (metric === 'glucose') {
      const f = (v: number) => glucoseFromCanonical(v, glucoseUnit).toFixed(glucoseUnit === 'mmol/L' ? 1 : 0);
      return <RangeRuler bands={glucoseBands(gctx, profile)} value={draft.value} min={40} max={320} format={f} />;
    }
    const f = (v: number) => uricFromCanonical(v, uricUnit).toFixed(uricUnit === 'mg/dL' ? 1 : 0);
    return <RangeRuler bands={uricBands(profile)} value={draft.value} min={1} max={12} format={f} />;
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeLog()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="log-title" onKeyDown={onEnter}>
        <div className="sheet-head">
          <h2 id="log-title">{editing ? 'Edit reading' : 'Log a reading'}</h2>
          <button className="icon-btn" onClick={closeLog} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">
          {!editing && (
            <div className="segmented" role="group" aria-label="Measurement">
              {(['bp', 'hr', 'glucose', 'uric'] as Metric[]).map((m) => (
                <button key={m} aria-pressed={metric === m} onClick={() => { setMetric(m); setError(''); setValue(''); }}>
                  {METRIC_NAME[m]}
                </button>
              ))}
            </div>
          )}

          {metric === 'bp' && (
            <>
              <div className="big-inputs">
                <label className="big-input">
                  <span>Systolic (top)</span>
                  <input ref={firstInput} inputMode="numeric" placeholder="120" value={sys} onChange={(e) => setSys(e.target.value.replace(/[^\d]/g, ''))} aria-describedby="bp-unit" />
                </label>
                <span className="big-slash" aria-hidden="true">/</span>
                <label className="big-input">
                  <span>Diastolic (bottom)</span>
                  <input inputMode="numeric" placeholder="80" value={dia} onChange={(e) => setDia(e.target.value.replace(/[^\d]/g, ''))} aria-describedby="bp-unit" />
                </label>
              </div>
              <div className="grid-2">
                <label className="field">
                  <span>Pulse (optional)</span>
                  <input className="input" inputMode="numeric" placeholder="bpm" value={pulse} onChange={(e) => setPulse(e.target.value.replace(/[^\d]/g, ''))} />
                </label>
                <div className="field">
                  <span id="bp-unit">Unit</span>
                  <div className="input" style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)' }}>mmHg</div>
                </div>
              </div>
              <div className="field">
                <span className="field-label">Position</span>
                <div className="chips">
                  {(['sitting', 'standing', 'lying'] as BpPosition[]).map((p) => (
                    <button key={p} className="chip" aria-pressed={position === p} onClick={() => setPosition(position === p ? undefined : p)}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                  {(['left', 'right'] as BpArm[]).map((a) => (
                    <button key={a} className="chip" aria-pressed={arm === a} onClick={() => setArm(arm === a ? undefined : a)}>
                      {a === 'left' ? 'Left arm' : 'Right arm'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {metric === 'hr' && (
            <>
              <div className="big-inputs">
                <label className="big-input">
                  <span>Heart rate (bpm)</span>
                  <input ref={firstInput} inputMode="numeric" placeholder="72" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))} />
                </label>
              </div>
              <div className="field">
                <span className="field-label">When</span>
                <div className="chips">
                  {(Object.keys(HR_CONTEXT_LABEL) as HrContext[]).map((c) => (
                    <button key={c} className="chip" aria-pressed={hctx === c} onClick={() => setHctx(c)}>
                      {HR_CONTEXT_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {metric === 'glucose' && (
            <>
              <div className="big-inputs">
                <label className="big-input">
                  <span>Blood glucose ({glucoseUnit})</span>
                  <input ref={firstInput} inputMode="decimal" placeholder={glucoseUnit === 'mg/dL' ? '95' : '5.3'} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} />
                </label>
                <div className="segmented" role="group" aria-label="Unit" style={{ marginBottom: 8 }}>
                  {(['mg/dL', 'mmol/L'] as GlucoseUnit[]).map((u) => (
                    <button key={u} aria-pressed={glucoseUnit === u} onClick={() => {
                      const v = num(value);
                      if (v !== undefined && !Number.isNaN(v) && u !== glucoseUnit) {
                        const c = glucoseToCanonical(v, glucoseUnit);
                        setValue(glucoseFromCanonical(c, u).toFixed(u === 'mmol/L' ? 1 : 0));
                      }
                      setGlucoseUnit(u);
                    }}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">When</span>
                <div className="chips">
                  {(Object.keys(GLUCOSE_CONTEXT_LABEL) as GlucoseContext[]).map((c) => (
                    <button key={c} className="chip" aria-pressed={gctx === c} onClick={() => setGctx(c)}>
                      {GLUCOSE_CONTEXT_LABEL[c]}
                    </button>
                  ))}
                </div>
                <span className="hint">Fasting means no food or drink other than water for at least 8 hours.</span>
              </div>
            </>
          )}

          {metric === 'uric' && (
            <div className="big-inputs">
              <label className="big-input">
                <span>Uric acid ({uricUnit})</span>
                <input ref={firstInput} inputMode="decimal" placeholder={uricUnit === 'mg/dL' ? '5.8' : '345'} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} />
              </label>
              <div className="segmented" role="group" aria-label="Unit" style={{ marginBottom: 8 }}>
                {(['mg/dL', 'µmol/L'] as UricUnit[]).map((u) => (
                  <button key={u} aria-pressed={uricUnit === u} onClick={() => {
                    const v = num(value);
                    if (v !== undefined && !Number.isNaN(v) && u !== uricUnit) {
                      const c = uricToCanonical(v, uricUnit);
                      setValue(uricFromCanonical(c, u).toFixed(u === 'mg/dL' ? 1 : 0));
                    }
                    setUricUnit(u);
                  }}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          {grade && (
            <div className="preview" aria-live="polite">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <strong>{grade.label}</strong>
                <Status level={grade.level} />
              </div>
              {rulerFor()}
              <p className="hint" style={{ color: 'var(--ink-2)' }}>{grade.detail}</p>
            </div>
          )}

          <label className="field">
            <span>Date and time</span>
            <input className="input" type="datetime-local" value={takenAt} max={nowLocalISO(new Date(Date.now() + 5 * 60_000))} onChange={(e) => setTakenAt(e.target.value)} />
          </label>

          <div className="field">
            <span className="field-label">Tags</span>
            <div className="chips">
              {TAGS.filter((t) => t !== IRREGULAR_TAG || metric === 'bp' || metric === 'hr').map((t) => (
                <button key={t} className="chip" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea className="textarea" placeholder="How you felt, what you ate, symptoms, medicine taken..." value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </label>

          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="sheet-foot">
          {editing && (
            <button className="btn btn-ghost btn-danger" style={{ marginRight: 'auto' }} onClick={() => { void removeEntry(editing.id); closeLog(); }}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button className="btn btn-ghost" onClick={closeLog}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()}>{editing ? 'Save changes' : 'Save reading'}</button>
        </div>
      </div>
    </div>
  );
}
