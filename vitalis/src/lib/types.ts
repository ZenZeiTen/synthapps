export type Metric = 'bp' | 'hr' | 'glucose' | 'uric';

export const METRICS: Metric[] = ['bp', 'hr', 'glucose', 'uric'];

export type GlucoseUnit = 'mg/dL' | 'mmol/L';
export type UricUnit = 'mg/dL' | 'µmol/L';

/** What was happening when a glucose reading was taken. */
export type GlucoseContext = 'fasting' | 'before-meal' | 'after-meal' | 'bedtime' | 'random';
/** What was happening when a heart rate reading was taken. */
export type HrContext = 'resting' | 'after-waking' | 'active' | 'after-exercise';
export type BpPosition = 'sitting' | 'standing' | 'lying';
export type BpArm = 'left' | 'right';

/**
 * One measurement. Values are stored in canonical units (mmHg, bpm, mg/dL)
 * so that statistics never mix units; `enteredUnit` remembers what the
 * person typed so the journal can show it back the same way.
 */
export interface Entry {
  id: string;
  metric: Metric;
  /** Local date and time the measurement was taken, ISO 8601 without zone: 2026-11-17T07:30 */
  takenAt: string;
  systolic?: number;
  diastolic?: number;
  /** Pulse shown by a blood pressure monitor, in bpm. */
  pulse?: number;
  /** Heart rate (bpm), glucose (mg/dL) or uric acid (mg/dL). */
  value?: number;
  enteredUnit?: string;
  glucoseContext?: GlucoseContext;
  hrContext?: HrContext;
  position?: BpPosition;
  arm?: BpArm;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type Sex = 'female' | 'male' | 'unspecified';

export interface Profile {
  name: string;
  birthYear?: number;
  sex: Sex;
  hasDiabetes: boolean;
  hasHypertension: boolean;
  hasGout: boolean;
  medications: string;
  doctorName: string;
  /** Targets a clinician set for this person; they replace the general ones in insights. */
  targets: {
    bpSystolicMax?: number;
    bpDiastolicMax?: number;
    glucoseFastingMin?: number;
    glucoseFastingMax?: number;
    glucoseAfterMealMax?: number;
    uricMax?: number;
  };
}

export interface Settings {
  glucoseUnit: GlucoseUnit;
  uricUnit: UricUnit;
  theme: 'system' | 'light' | 'dark';
  /** Has the person acknowledged that the app does not give medical advice. */
  acknowledged: boolean;
  /** Questions the person wrote themselves, for the next appointment. */
  customQuestions: string[];
  /** Suggested questions the person chose to leave out of the report. */
  excludedQuestions: string[];
}

/**
 * Severity levels used everywhere a reading or a finding is graded, from
 * least to most concerning: ok, low (below the usual range), mild, watch,
 * high, urgent. `neutral` is for readings that are not graded, such as a
 * heart rate taken during exercise.
 */
export type Level = 'neutral' | 'ok' | 'low' | 'mild' | 'watch' | 'high' | 'urgent';

export interface Grade {
  level: Level;
  /** Short category name, for example "Stage 1 hypertension range". */
  label: string;
  /** One plain sentence about what the category means. */
  detail: string;
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  sex: 'unspecified',
  hasDiabetes: false,
  hasHypertension: false,
  hasGout: false,
  medications: '',
  doctorName: '',
  targets: {}
};

export const DEFAULT_SETTINGS: Settings = {
  glucoseUnit: 'mg/dL',
  uricUnit: 'mg/dL',
  theme: 'system',
  acknowledged: false,
  customQuestions: [],
  excludedQuestions: []
};
