/**
 * English text. This file is the source of truth: id.ts must have the same
 * shape (TypeScript checks it), so a missing translation fails the build.
 *
 * Values are strings, or functions when the text includes numbers or names.
 * Numbers arrive already formatted for the language.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const en = {
  meta: {
    htmlLang: 'en',
    locale: 'en-GB',
    languageName: 'English',
    short: 'EN',
    /** Shown by the browser and the phone when the app is installed. */
    installName: 'Vitalis Health Tracker',
    installDescription:
      'Record blood pressure, heart rate, blood glucose and uric acid. See trends, get plain-language insights and share a PDF report with your doctor.',
    shortcutLog: 'Log a reading',
    shortcutLogShort: 'Log'
  },

  common: {
    metric: { bp: 'Blood pressure', hr: 'Heart rate', glucose: 'Blood glucose', uric: 'Uric acid' },
    level: {
      neutral: 'Not graded',
      ok: 'In range',
      low: 'Below range',
      mild: 'Slightly above',
      watch: 'Above range',
      high: 'High',
      urgent: 'Needs attention'
    },
    glucoseContext: {
      fasting: 'Fasting',
      'before-meal': 'Before a meal',
      'after-meal': '1-2 h after a meal',
      bedtime: 'Bedtime',
      random: 'Any time'
    },
    hrContext: {
      resting: 'Resting',
      'after-waking': 'After waking',
      active: 'During activity',
      'after-exercise': 'After exercise'
    },
    position: { sitting: 'Sitting', standing: 'Standing', lying: 'Lying' },
    positionLower: { sitting: 'sitting', standing: 'standing', lying: 'lying' },
    arm: { left: 'Left arm', right: 'Right arm' },
    armLower: { left: 'left arm', right: 'right arm' },
    pulseValue: (n: string) => `pulse ${n}`,
    /** Labels for the fixed tags. Tags are stored by these English keys. */
    tags: {
      'Took medication': 'Took medication',
      'Missed medication': 'Missed medication',
      Coffee: 'Coffee',
      Exercise: 'Exercise',
      Stressed: 'Stressed',
      'Poor sleep': 'Poor sleep',
      'Salty meal': 'Salty meal',
      Alcohol: 'Alcohol',
      Unwell: 'Unwell',
      Pain: 'Pain',
      'Irregular heartbeat': 'Irregular heartbeat'
    } as Record<string, string>,
    readings: (n: number) => plural(n, 'reading', 'readings'),
    today: 'Today',
    yesterday: 'Yesterday',
    close: 'Close',
    cancel: 'Cancel',
    language: 'Language',
    saveOrSend: 'Save or send',
    mainNav: 'Main',
    noReading: 'no reading',
    sampleLunch: 'Nasi goreng for lunch',
    sampleRedMeat: 'Before cutting down on red meat',
    switchLanguage: 'Switch language'
  },

  ranges: {
    sys: {
      low: ['Low', 'Below 90 mmHg systolic is often called low blood pressure. It matters most if you feel dizzy, faint or unwell.'],
      normal: ['Normal', 'Systolic pressure under 120 mmHg is in the normal range.'],
      elevated: ['Elevated', '120 to 129 mmHg systolic is called elevated. Lifestyle changes help keep it from rising.'],
      stage1: ['Stage 1 range', '130 to 139 mmHg systolic is in the stage 1 hypertension range.'],
      stage2: ['Stage 2 range', '140 mmHg systolic or more is in the stage 2 hypertension range.'],
      severe: ['Severe', 'Above 180 mmHg systolic is severely high. Rest 5 minutes and measure again; get urgent care if it stays this high or you have symptoms.']
    },
    dia: {
      low: ['Low', 'Below 60 mmHg diastolic is often called low. It matters most if you have symptoms.'],
      normal: ['Normal', 'Diastolic pressure under 80 mmHg is in the normal range.'],
      stage1: ['Stage 1 range', '80 to 89 mmHg diastolic is in the stage 1 hypertension range.'],
      stage2: ['Stage 2 range', '90 mmHg diastolic or more is in the stage 2 hypertension range.'],
      severe: ['Severe', 'Above 120 mmHg diastolic is severely high. Measure again after resting; get urgent care if it stays this high or you have symptoms.']
    },
    bpAboveTarget: 'Above your target',
    bpAboveTargetDetail: (max: number, which: 'systolic' | 'diastolic') => `Your clinician's target is below ${max} mmHg ${which}.`,
    bpLow: ['Low', 'Below 90/60 mmHg is often called low blood pressure. It matters most if you feel dizzy, faint or unwell.'],
    bpSevere: [
      'Severe',
      'Above 180/120 mmHg is severely high. Rest 5 minutes and measure again. Call emergency services if you have chest pain, shortness of breath, back pain, numbness, weakness, trouble speaking or a change in vision.'
    ],
    hr: {
      veryLow: ['Very slow', 'A resting heart rate under 40 bpm needs prompt medical advice, especially with dizziness, fainting or tiredness.'],
      low: ['Slow', '40 to 59 bpm at rest is called bradycardia. It is often normal in fit people and during sleep; it matters if you have symptoms.'],
      normal: ['Normal', '60 to 100 bpm is the usual resting range for adults.'],
      high: ['Fast', 'Over 100 bpm at rest is called tachycardia. Caffeine, stress, fever or dehydration can cause it; repeated readings are worth discussing.'],
      veryHigh: ['Very fast', 'A resting heart rate over 120 bpm is well above range. Seek care promptly if it persists or comes with chest pain, breathlessness or fainting.'],
      notResting: ['Not at rest', 'Heart rate during or after activity is not compared with the resting range.']
    },
    glucose: {
      veryLow: ['Very low', 'Below 54 mg/dL (3.0 mmol/L) is level 2 hypoglycaemia. Take fast-acting sugar now and follow your plan; get help if you cannot treat it yourself.'],
      low: ['Low', 'Below 70 mg/dL (3.9 mmol/L) is low. Take 15 g of fast-acting sugar and check again in 15 minutes.'],
      belowTarget: 'Below target',
      belowTargetDetail: (min: number) => `Your before-meal target starts at ${min} mg/dL.`,
      inTarget: 'In target',
      inTargetBeforeDetail: (min: number, max: number) => `In your before-meal target of ${min} to ${max} mg/dL.`,
      inTargetAfterDetail: (max: number) => `Under your after-meal target of ${max} mg/dL.`,
      aboveTarget: 'Above target',
      aboveTargetBeforeDetail: (max: number) => `Above your before-meal target of ${max} mg/dL.`,
      aboveTargetAfterDetail: (max: number) => `At or above your after-meal target of ${max} mg/dL.`,
      high: 'High',
      highBeforeDetail: 'Well above the before-meal target. Follow your care plan for high readings.',
      highAfterDetail: 'Well above target. Follow your care plan for high readings.',
      veryHigh: 'Very high',
      veryHighDiabetesDetail:
        'Very high. Check ketones if your plan says so, drink water, and contact your care team; get urgent care if you are vomiting, drowsy or breathing fast.',
      veryHighDetail: 'Very high. Contact a doctor today; get urgent care if you are vomiting, very thirsty, drowsy or confused.',
      fastingNormal: ['Normal', 'A fasting glucose of 70 to 99 mg/dL is in the normal range.'],
      prediabetes: ['Prediabetes range', 'A fasting glucose of 100 to 125 mg/dL is in the prediabetes range. A lab test confirms it.'],
      diabetesRange: ['Diabetes range', 'A fasting glucose of 126 mg/dL or more is in the diabetes range. Diagnosis needs lab tests, usually repeated.'],
      otherNormal: ['Normal', 'Under 140 mg/dL is the usual range outside fasting.'],
      aboveUsual: ['Above usual', '140 to 199 mg/dL after eating is higher than usual and worth checking with a lab test.'],
      otherHigh: ['High', '200 mg/dL or more is high. With symptoms such as thirst or frequent urination it can point to diabetes; see a doctor.']
    },
    uric: {
      below: ['Below range', 'Below the typical range. This is rarely a concern on its own; mention it if it keeps happening.'],
      normal: 'Normal',
      inTarget: 'In target',
      targetDetail: (target: string) => `Below your target of ${target} mg/dL. Keeping uric acid under target lets gout crystals dissolve over time.`,
      rangeDetail: (low: string, high: string) => `Within the typical range of about ${low} to ${high} mg/dL. Labs differ slightly.`,
      aboveTarget: 'Above target',
      aboveTargetDetail: (target: string) => `At or above your target of ${target} mg/dL.`,
      aboveRange: 'Above range',
      aboveRangeDetail: 'Above the typical range (hyperuricaemia). Above about 6.8 mg/dL, urate crystals can form in joints.',
      wellAbove: ['Well above range', '9 mg/dL or more is well above range and raises the risk of gout attacks and kidney stones.']
    }
  },

  insights: {
    period: (days: number) => (days > 0 ? `the last ${days} days` : 'all your readings'),
    scope: { bp: 'Blood pressure', hr: 'Heart rate', glucose: 'Blood glucose', uric: 'Uric acid', general: 'General' },
    bpAverage: (avg: string, label: string) => `Average ${avg} mmHg: ${label}`,
    bpAverageBody: (n: number, period: string, detail: string) => `Across ${plural(n, 'reading', 'readings')} in ${period}. ${detail}`,
    bpFew: 'More readings give a clearer picture',
    bpFewBody:
      'Doctors judge home blood pressure on an average of many readings. A common plan: two readings a minute apart, morning and evening, for 7 days, sitting with your back supported and feet flat after 5 minutes of rest.',
    bpSevere: (n: number) => `${plural(n, 'reading', 'readings')} above 180/120 mmHg`,
    bpSevereBody:
      'Readings this high need a doctor soon, even without symptoms. With chest pain, shortness of breath, back pain, numbness, weakness, trouble speaking or vision changes, call emergency services straight away.',
    bpLow: (n: number) => `${plural(n, 'reading', 'readings')} below 90 mmHg systolic`,
    bpLowBody: 'Low readings matter mostly if you feel dizzy, light-headed or faint, especially when standing up. Note any symptoms alongside the reading.',
    bpRising: (v: string) => `Systolic pressure is rising about ${v} mmHg a month`,
    bpRisingBody: 'The trend line across your readings is going up. Changes in medication, salt, sleep, stress or weight can all play a part.',
    bpFalling: (v: string) => `Systolic pressure is falling about ${v} mmHg a month`,
    bpFallingBody: 'The trend line across your readings is going down. If you also feel dizzy, mention it, as medication may need adjusting.',
    bpMorning: (d: string) => `Mornings run ${d} mmHg higher than evenings`,
    bpMorningBody: (am: string, pm: string) =>
      `Morning systolic averages ${am} mmHg, evening ${pm} mmHg. A higher morning pressure is worth mentioning; the timing of medication can sometimes help.`,
    bpEvening: (d: string) => `Evenings run ${d} mmHg higher than mornings`,
    bpEveningBody: (am: string, pm: string) =>
      `Evening systolic averages ${pm} mmHg, morning ${am} mmHg. Activity, meals, salt and stress during the day can raise evening readings.`,
    bpArms: (d: string) => `Your arms differ by ${d} mmHg`,
    bpArmsBody: 'A systolic difference of more than 10 mmHg between arms is worth telling your doctor about. Measure on the arm with the higher reading.',
    bpVariable: 'Readings vary a lot',
    bpVariableBody: (sd: string) =>
      `Your systolic readings swing by about ${sd} mmHg either side of the average. Measuring the same way each time (same arm, after 5 minutes rest, no coffee or exercise in the previous 30 minutes) makes readings easier to compare.`,
    bpPulsePressure: (v: string) => `Wide gap between the two numbers (${v} mmHg)`,
    bpPulsePressureBody:
      'The difference between systolic and diastolic pressure (the pulse pressure) averages 60 mmHg or more. This is common with age and stiffer arteries and is worth mentioning.',

    hrAverage: (v: string, label: string) => `Resting heart rate averages ${v} bpm: ${label}`,
    hrAverageBody: (n: number, period: string, detail: string) =>
      `From ${plural(n, 'resting reading', 'resting readings')} in ${period}, including the pulse from blood pressure readings. ${detail}`,
    hrHigh: (n: number) => `${plural(n, 'resting reading', 'resting readings')} over 100 bpm`,
    hrHighBody: 'A fast heart rate at rest has many causes, from caffeine, fever and dehydration to thyroid or heart rhythm problems. Note how you felt at the time.',
    hrLow: (n: number) => `${plural(n, 'resting reading', 'resting readings')} under 50 bpm`,
    hrLowBody:
      'A slow heart rate is often normal for fit people. It needs checking if you feel dizzy, tired, short of breath or faint, or take medicines that slow the heart.',
    hrIrregular: (n: number) => `Irregular heartbeat noted ${plural(n, 'time', 'times')}`,
    hrIrregularBody: 'Many monitors show a symbol when the rhythm is uneven. Repeated irregular readings can be a sign of atrial fibrillation and are worth an ECG.',
    hrRising: (v: string) => `Resting heart rate is rising about ${v} bpm a month`,
    hrRisingBody: 'A rising resting rate can follow illness, poor sleep, stress, less activity or a change in medication.',
    hrFalling: (v: string) => `Resting heart rate is falling about ${v} bpm a month`,
    hrFallingBody: 'A falling resting rate often follows better fitness. If you feel tired or dizzy, mention it.',

    glucoseFasting: (diabetes: boolean, v: string, label: string) => `${diabetes ? 'Fasting and before-meal' : 'Fasting'} glucose averages ${v}: ${label}`,
    glucoseFastingBody: (n: number, period: string, detail: string) => `From ${plural(n, 'reading', 'readings')} in ${period}. ${detail}`,
    glucoseAfter: (v: string, label: string) => `After-meal glucose averages ${v}: ${label}`,
    glucoseAfterBody: (n: number, detail: string) => `From ${plural(n, 'reading', 'readings')} taken 1 to 2 hours after eating. ${detail}`,
    glucoseRandom: (v: string) => `Glucose averages ${v}`,
    glucoseRandomBody:
      'Mark readings as fasting, before a meal or after a meal. Fasting readings, taken after at least 8 hours without food, are the easiest to compare with reference ranges.',
    glucoseLows: (n: number, v: string) => `${plural(n, 'low reading', 'low readings')} below ${v}`,
    glucoseLowsBody: (veryLow: number, v54: string) =>
      `${veryLow ? `${plural(veryLow, 'reading', 'readings')} below ${v54}, which counts as serious low glucose. ` : ''}Treat lows with 15 g of fast-acting sugar, check again after 15 minutes, and tell your doctor how often they happen.`,
    glucoseVeryHigh: (n: number, v: string) => `${plural(n, 'reading', 'readings')} at ${v} or more`,
    glucoseVeryHighBody: 'Very high glucose needs a doctor soon. Seek urgent care if it comes with vomiting, stomach pain, fast breathing, drowsiness or confusion.',
    glucoseInTarget: (pct: string) => `${pct}% of readings in target`,
    glucoseInTargetBody:
      'This counts the readings you logged, which may not reflect the whole day. Continuous monitors aim for more than 70% of the day between 70 and 180 mg/dL.',
    glucoseSwings: 'Glucose swings widely',
    glucoseSwingsBody: (pct: string) => `Your readings vary by ${pct}% around the average. More than 36% is considered high variability and raises the chance of lows.`,
    glucoseA1c: (v: string) => `Your average suggests an HbA1c near ${v}%`,
    glucoseA1cBody: (n: number, avg: string) =>
      `A rough estimate from the average of ${plural(n, 'reading', 'readings')} (${avg}), using the ADAG formula. Spot readings miss much of the day, so a lab HbA1c test is the reliable number.`,

    uricLatest: (v: string, label: string) => `Latest uric acid ${v}: ${label}`,
    uricLatestAverage: (n: number, v: string) => `Average of ${plural(n, 'reading', 'readings')}: ${v}. `,
    uricRising: (v: string) => `Uric acid is rising about ${v} a month`,
    uricRisingBody: 'Purine-rich food (organ meats, some seafood), alcohol, sugary drinks, dehydration and some medicines can raise uric acid.',
    uricFalling: (v: string) => `Uric acid is falling about ${v} a month`,
    uricFallingBody: 'A falling level is a good sign if you are working to lower it.',
    uricTips: 'Ways to bring uric acid down',
    uricTipsBody:
      'Drink plenty of water, limit alcohol (especially beer) and sugary drinks, eat less red and organ meat and shellfish, and aim for a healthy weight. Ask before stopping any medicine that may raise uric acid.',

    empty: 'No readings in this period',
    emptyBody: 'Log a reading to see your averages, trends and what they mean.'
  },

  questions: {
    'bp.confirm': (avg: string) =>
      `My home average is ${avg} mmHg. Does this mean I have high blood pressure, or should I do 24-hour monitoring to confirm it?`,
    'bp.target': 'What blood pressure target is right for me, and which lifestyle changes would make the biggest difference?',
    'bp.treatment': 'My readings are still above target on my current treatment. Should the dose, the medicine or the time I take it change?',
    'bp.severe': 'I had readings above 180/120. What should I do if it happens again, and when should I go to the emergency department?',
    'bp.morning': 'My morning readings are higher than my evening ones. Would taking my medicine at a different time help?',
    'bp.low': 'I sometimes get low readings. Could any of my medicines be causing this, and what should I do if I feel dizzy?',
    'bp.arms': 'My two arms read more than 10 mmHg apart. Does that need further checks?',
    'bp.rising': 'My blood pressure has been rising. What could be causing it?',
    'bp.monitor': 'Can we check my home monitor against your clinic reading to make sure it is accurate?',
    'hr.high': 'My resting heart rate is often over 100. Could thyroid problems, anaemia, caffeine or a rhythm problem be the cause? Do I need an ECG?',
    'hr.low': 'My heart rate is often below 50. Is that normal for me, or could one of my medicines be slowing it?',
    'hr.irregular': 'My monitor showed an irregular heartbeat. Should I be checked for atrial fibrillation?',
    'hr.target': 'What resting heart rate should I aim for, and which symptoms with a fast or slow pulse mean I should call you?',
    'glucose.prediabetes': 'Some of my glucose readings are in the prediabetes range. Should I have an HbA1c or a glucose tolerance test?',
    'glucose.risk': 'What can I do to lower my risk of type 2 diabetes?',
    'glucose.diabetesRange': 'My glucose readings are in the diabetes range. Which tests confirm it, and what happens next?',
    'glucose.aboveTarget': 'My readings are often above target. Are my targets still right for me, and should my treatment change?',
    'glucose.ketones': 'When should I check for ketones, and what should I do if they are high?',
    'glucose.lows': (n: number) => `I had ${plural(n, 'low reading', 'low readings')}. How should I change food, activity or medication to prevent them?`,
    'glucose.glucagon': 'Should I carry glucagon, and should the people around me know how to use it?',
    'glucose.cgm': 'My readings swing widely. Would a continuous glucose monitor help?',
    'glucose.frequency': 'How often, and at what times, should I check my glucose?',
    'uric.goutTreatment': 'My uric acid is above target. Should my urate-lowering medicine be increased to get below 6 mg/dL?',
    'uric.treatment': 'My uric acid is above the usual range. Do I need treatment, or are diet and lifestyle changes enough for now?',
    'uric.medicines': 'Could any of my medicines, such as water tablets (diuretics) or low-dose aspirin, be raising my uric acid?',
    'uric.kidneys': 'Should my kidney function be checked, and am I at risk of kidney stones?',
    'uric.flare': 'How should I manage a gout flare while I am on treatment?',
    'uric.retest': 'How often should my uric acid be re-tested?',
    'general.medicines': 'Do any of my medicines or supplements affect these numbers?',
    'general.tracking': 'Which of these readings should I keep tracking, and how often?'
  },

  labs: {
    'bp.abpm': ['24-hour ambulatory blood pressure monitoring', 'Confirms whether pressure is high across a whole day and night, and rules out "white coat" readings.'],
    'bp.kidney': ['Kidney function and electrolytes (creatinine, eGFR, sodium, potassium)', 'High blood pressure can affect the kidneys, and some blood pressure medicines change potassium.'],
    'bp.uacr': ['Urine albumin-to-creatinine ratio (UACR) and urinalysis', 'Finds small amounts of protein in the urine, an early sign of kidney strain.'],
    'bp.lipids': ['Lipid panel (cholesterol)', 'Blood pressure and cholesterol together set your heart and stroke risk.'],
    'bp.glucose': ['Fasting glucose or HbA1c', 'Diabetes and high blood pressure often occur together.'],
    'bp.tsh': ['Thyroid function (TSH)', 'An over- or under-active thyroid can raise blood pressure.'],
    'bp.ecg': ['12-lead ECG', 'Shows whether high blood pressure has put strain on the heart.'],
    'bp.aldo': [
      'Aldosterone-to-renin ratio',
      'Screens for primary aldosteronism, a hormone cause of high blood pressure that is easy to miss, especially if pressure stays high on treatment or potassium is low.'
    ],
    'hr.ecg': ['12-lead ECG', 'Records the heart rhythm and shows conduction problems.'],
    'hr.holter': ['Holter or event monitor (24 hours to 2 weeks)', 'Catches rhythm changes that come and go.'],
    'hr.thyroid': ['Thyroid function (TSH, free T4)', 'Thyroid problems commonly speed up or slow down the heart.'],
    'hr.fbc': ['Full blood count', 'Anaemia can make the heart beat faster.'],
    'hr.electrolytes': ['Electrolytes (potassium, magnesium)', 'Low or high levels can disturb the heart rhythm.'],
    'glucose.a1c': ['HbA1c', 'Shows your average glucose over the past 2 to 3 months; 5.7-6.4% is the prediabetes range and 6.5% or more the diabetes range.'],
    'glucose.fpg': ['Fasting plasma glucose (lab)', 'A lab measurement is more accurate than a home meter.'],
    'glucose.ogtt': ['Oral glucose tolerance test (OGTT)', 'Shows how your body handles a measured sugar drink over 2 hours.'],
    'glucose.lipidsKidney': [
      'Lipid panel and kidney tests (eGFR, UACR)',
      'Checks heart and kidney risk, which rises with high glucose; recommended at least yearly with diabetes.'
    ],
    'glucose.alt': ['Liver enzymes (ALT)', 'Raised glucose often goes with fatty liver.'],
    'glucose.eyesFeet': ['Dilated eye exam and foot check', 'Yearly checks for diabetes-related eye and nerve changes.'],
    'glucose.cpeptide': ['C-peptide and islet autoantibodies', 'Help tell type 1 from type 2 diabetes when the type is unclear.'],
    'uric.repeat': ['Repeat serum uric acid', 'One reading can mislead. During a gout flare uric acid can read falsely normal, so repeat it about 2 weeks after a flare settles.'],
    'uric.kidney': ['Kidney function (creatinine, eGFR) and urinalysis', 'The kidneys clear uric acid, and high levels can lead to kidney stones.'],
    'uric.metabolic': ['Lipid panel, glucose and HbA1c', 'High uric acid often comes with raised cholesterol, glucose and blood pressure.'],
    'uric.liver': ['Liver function tests and full blood count', 'Checked before and during urate-lowering treatment.'],
    'uric.crystals': ['Joint fluid test for crystals', 'Confirms gout if a joint is hot, red and swollen.'],
    'uric.hla': [
      'HLA-B*5801 test',
      'Recommended before starting allopurinol for people of Southeast Asian (for example Han Chinese, Korean or Thai) or African descent, who have a higher risk of a severe skin reaction.'
    ],
    'uric.urine24': ['24-hour urine uric acid', 'Useful if you have had kidney stones.']
  },

  specialists: {
    gp: ['General practitioner or internist', 'Your first stop for any of these readings. They can order the tests above, start treatment and refer you on.'],
    cardiologist: [
      'Cardiologist',
      'Blood pressure that stays high on three or more medicines, an abnormal ECG, palpitations, an irregular or persistently fast or slow heartbeat, or chest pain.'
    ],
    ep: ['Cardiac electrophysiologist', 'A confirmed heart rhythm problem such as atrial fibrillation that needs specialist treatment.'],
    endocrinologist: [
      'Endocrinologist',
      'Diabetes that is not reaching target, frequent lows, suspected type 1 diabetes, thyroid problems, or a suspected hormone cause of high blood pressure.'
    ],
    nephrologist: [
      'Nephrologist (kidney specialist)',
      'Falling kidney function, protein in the urine, blood pressure that is hard to control, or kidney stones with high uric acid.'
    ],
    rheumatologist: ['Rheumatologist', 'Gout attacks, lumps of crystals under the skin (tophi), or uric acid that stays above target on treatment.'],
    dietitian: ['Dietitian or diabetes educator', 'Help with meal plans to lower salt, glucose or uric acid, and with using a meter or insulin.']
  },

  emergency: [
    'Blood pressure above 180/120 mmHg with chest pain, shortness of breath, back pain, numbness or weakness, trouble speaking, or a change in vision.',
    'Chest pain or pressure, fainting, or a very fast or very slow heartbeat with dizziness or breathlessness.',
    'Glucose below 54 mg/dL (3.0 mmol/L) that does not rise after treatment, or confusion, seizures or unconsciousness.',
    'Glucose above 300 mg/dL (16.7 mmol/L) with vomiting, stomach pain, fast breathing, fruity-smelling breath or drowsiness.',
    'A hot, red, very painful joint together with fever, which can be an infection rather than gout.'
  ],

  nav: {
    today: 'Today',
    trends: 'Trends',
    journal: 'Journal',
    insights: 'Insights',
    report: 'Report',
    settings: 'Settings',
    logReading: 'Log a reading',
    railFoot: 'Stored on this device only. Not medical advice.',
    reportAria: 'Report for your doctor',
    updateReady: 'A new version of Vitalis is ready',
    reload: 'Reload',
    undo: 'Undo'
  },

  today: {
    greeting: (h: number, name: string) => {
      const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      return name ? `${part}, ${name}` : part;
    },
    summary: (weekCount: number, streak: number) =>
      `${plural(weekCount, 'reading', 'readings')} this week${streak > 1 ? `, logged ${streak} days in a row` : ''}.`,
    firstReading: 'Log your first reading to start seeing trends.',
    urgentCare: 'When to get urgent care',
    standsOut: 'What stands out',
    allInsights: 'All insights',
    nothingStandsOut: 'Nothing needs attention in the last 30 days.',
    doctorSoon: 'Seeing a doctor soon?',
    doctorSoonBody: 'Make a PDF with your averages, charts, findings and the questions you want to ask. It opens on any phone or computer and prints cleanly.',
    makeReport: 'Make a report',
    noReadings: 'No readings yet.',
    add: (what: string) => `Add ${what}`,
    addWhat: { bp: 'blood pressure', hr: 'heart rate', glucose: 'blood glucose', uric: 'uric acid' },
    openTrends: (metric: string) => `${metric}: open trends`,
    pulse: (n: number) => `Pulse ${n} bpm`,
    systolic: 'Systolic',
    diastolic: 'Diastolic'
  },

  trends: {
    title: 'Trends',
    intro: 'Each dot is a reading, coloured by what it means. The bold line is the 7-day average.',
    periods: { 7: '7 days', 30: '30 days', 90: '90 days', 365: 'Year', 0: 'All' } as Record<number, string>,
    measurement: 'Measurement',
    period: 'Period',
    glucoseShow: 'Glucose readings to show',
    allReadings: 'All readings',
    systolic: 'systolic',
    diastolic: 'diastolic',
    bpLine: (sys: number) => `${sys} systolic`,
    diaLine: (dia: number) => `${dia} diastolic`,
    legendBpAverage: '7-day average (upper: systolic, lower: diastolic)',
    legendThresholds: 'Stage 1 thresholds',
    legendAverage: '7-day average',
    legendRange: 'Usual range',
    legendBeforeMealTarget: 'Before-meal target',
    legendUsualOutsideFasting: 'Usual range outside fasting',
    average: 'Average',
    lowHigh: 'Lowest to highest',
    inRange: 'In range',
    trendMonth: 'Trend per month',
    needsMore: 'Needs 5+ readings over a week',
    howTheyFall: 'How readings fall',
    tod: [
      ['Morning', '4:00-11:00'],
      ['Midday', '11:00-17:00'],
      ['Evening', '17:00-24:00'],
      ['Night', '0:00-4:00']
    ] as [string, string][],
    readings: 'Readings',
    seeAll: (n: number) => `See all ${n}`,
    noneInPeriod: (metric: string) => `No ${metric} readings in this period.`,
    chartAria: (series: string, n: number, canOpen: boolean) =>
      `Chart of ${series}, ${plural(n, 'reading', 'readings')}. Use the arrow keys to step through readings${canOpen ? ' and Enter to open one' : ''}.`,
    chartAnd: ' and ',
    chartEmpty: 'No readings in this period'
  },

  journal: {
    title: 'Journal',
    intro: 'Every reading, newest first. Choose one to edit or delete it.',
    show: 'Show',
    all: 'All',
    search: 'Search notes and tags',
    emptyTitle: 'Your journal is empty',
    emptyBody: 'Readings you log appear here with their date, time, context and notes.',
    noMatch: 'No readings match. Try another filter or search.',
    older: 'Show older readings',
    editAria: (metric: string, value: string, unit: string, label: string) => `${metric} ${value} ${unit}, ${label}. Edit`
  },

  insightsPage: {
    title: 'Insights',
    intro: 'What your readings suggest, what to ask, which tests to consider and who to see. This is general information to discuss with a clinician, not a diagnosis.',
    periods: { 30: '30 days', 90: '90 days', 365: 'Year', 0: 'All' } as Record<number, string>,
    findings: 'Findings',
    questions: 'Questions for your doctor',
    copy: 'Copy',
    copied: (n: number) => `Copied ${n} questions`,
    copyBlocked: 'Copying is blocked here. Use the report instead.',
    questionsHint: 'Ticked questions go into your PDF report. Questions marked "from your readings" were raised by your own numbers.',
    yourQuestion: 'Your question',
    fromReadings: ', from your readings',
    removeQuestion: 'Remove question',
    included: 'Included',
    addQuestion: 'Add your own question',
    add: 'Add',
    urgentTitle: 'When to get urgent care',
    urgentIntro:
      'Call your local emergency number (112 in Indonesia, Europe and many other countries; 911 in North America) or go to an emergency department if you have:',
    tests: 'Tests to ask about',
    showFewer: 'Show fewer',
    showAll: (n: number) => `Show all ${n}`,
    worthAsking: 'Worth asking about',
    noTests: 'Log readings to see which tests relate to them.',
    noSuggestedTests: 'None of your readings point to a particular test. Choose "Show all" to see the tests usually linked to these measurements.',
    doctors: 'Which doctor to see',
    suggestedNow: 'Suggested now',
    disclaimer:
      'Vitalis compares readings with published adult reference ranges (ACC/AHA blood pressure categories, ADA glucose criteria and targets, common uric acid laboratory ranges and the ACR gout target). Home devices vary in accuracy, and ranges differ by age, pregnancy, medical history and laboratory. Only a qualified clinician can diagnose a condition or change treatment.'
  },

  reportPage: {
    title: 'Report for your doctor',
    intro: 'A PDF of your readings for an appointment, a second opinion or your own records. Your data stays on this device until you share the file.',
    period: 'Period',
    periods: { 30: 'Last 30 days', 90: 'Last 90 days', 180: 'Last 6 months', 365: 'Last year', 0: 'All readings' } as Record<number, string>,
    include: 'Include',
    sections: {
      summary: ['Summary table', 'Averages, ranges and trends for each measurement'],
      charts: ['Charts', 'One chart per measurement'],
      insights: ['Findings', 'What the readings suggest, in plain language'],
      questions: ['Questions', 'The questions ticked on the Insights page, with space for answers'],
      tests: ['Tests and doctors', 'Tests to ask about, who to see and when to get urgent care'],
      log: ['All readings', 'A table of every reading with its notes']
    },
    download: 'Download PDF',
    making: 'Making the PDF...',
    share: 'Share PDF',
    csv: 'Export CSV',
    none: 'There are no readings in this period yet.',
    downloaded: 'Report downloaded',
    shared: 'Report ready to save or send',
    failed: (msg: string) => `The report could not be made: ${msg}`,
    patient: 'Patient details on the report',
    noName: 'No name',
    born: (y: number) => `, born ${y}`,
    medications: (m: string) => `Medications: ${m}.`,
    noMedications: 'No medications recorded.',
    editProfile: 'Edit profile',
    footnote: (from: string, to: string, findings: number, questions: number) =>
      `Averages for ${from} to ${to}. The report also lists ${plural(findings, 'finding', 'findings')} and ${plural(questions, 'question', 'questions')}.`,
    reportLanguage: 'The report is written in the app language. Switch language to make it in English or Indonesian.'
  },

  settingsPage: {
    title: 'Settings',
    intro: 'Your profile tunes the ranges used for insights and appears on your report. Everything is stored only on this device.',
    profile: 'Profile',
    name: 'Name',
    birthYear: 'Year of birth',
    sex: 'Sex',
    sexOptions: { unspecified: 'Prefer not to say', female: 'Female', male: 'Male' },
    sexHint: 'Used for the uric acid range.',
    doctor: 'Doctor',
    doctorPlaceholder: 'Name and clinic',
    conditions: 'Diagnosed conditions',
    hypertension: 'High blood pressure',
    diabetes: 'Diabetes',
    diabetesHint: 'Glucose is compared with treatment targets instead of diagnostic ranges.',
    gout: 'Gout',
    goutHint: 'Uric acid is compared with the treatment target of below 6 mg/dL.',
    medications: 'Medications and doses',
    medicationsPlaceholder: 'For example: amlodipine 5 mg in the morning',
    targets: 'Targets from your doctor',
    targetsIntro: 'Optional. Leave blank to use general ranges. Glucose and uric acid targets are in mg/dL.',
    tSys: 'Blood pressure: keep systolic below',
    tDia: 'Blood pressure: keep diastolic below',
    tFastMin: 'Fasting glucose from',
    tFastMax: 'Fasting glucose up to',
    tAfter: 'After-meal glucose below',
    tUric: 'Uric acid below',
    targetsHint: 'Glucose targets apply when Diabetes is ticked.',
    discard: 'Discard',
    saveProfile: 'Save profile',
    profileSaved: 'Profile saved',
    language: 'Language',
    languageHint: 'Changes the whole app, including insights and the PDF report.',
    glucoseUnit: 'Glucose unit',
    glucoseUnitHint: 'mg/dL is used in Indonesia and the US; mmol/L in the UK, Europe and Australia.',
    uricUnit: 'Uric acid unit',
    appearance: 'Appearance',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    install: 'Install Vitalis',
    installBody: 'Add it to your home screen. It opens full screen and works without internet.',
    installButton: 'Install app',
    data: 'Your data',
    dataSummary: (n: number) => `${plural(n, 'reading', 'readings')}, stored in this browser only.`,
    mayClear: 'The browser may clear them if storage runs low, so keep a backup.',
    backup: 'Back up data',
    restore: 'Restore a backup',
    protect: 'Protect storage',
    protected: 'Storage is now protected',
    protectDenied: 'The browser did not allow it. Installing the app usually helps.',
    addSample: 'Add sample readings',
    sampleAdded: 'Added 60 days of sample readings',
    deleteAll: 'Delete all readings',
    deleteConfirm: (n: number) => `Delete all ${n} readings from this device? This cannot be undone. Back up first if you may need them.`,
    deleted: 'All readings deleted',
    backupSaved: 'Backup saved',
    restoreProfile: 'Also restore the profile from the backup?',
    restored: (n: number, skipped: number) => `Restored ${plural(n, 'reading', 'readings')}${skipped ? `, skipped ${skipped} that could not be read` : ''}`,
    about: 'About',
    aboutBody:
      'Vitalis is a personal record, not a medical device. It does not diagnose, treat or replace advice from a doctor, and it cannot detect an emergency. Ranges follow the ACC/AHA blood pressure categories, ADA glucose standards, typical laboratory uric acid ranges and the ACR gout target.',
    version: (v: string) => `Version ${v}`
  },

  welcome: {
    headline: 'Your vital signs, on one clear page.',
    body: 'Record blood pressure, heart rate, blood glucose and uric acid in a few taps. See where each reading falls, how it changes over weeks, and what is worth raising with your doctor. Your readings stay on this device.',
    quick: 'Two quick questions',
    sex: 'Sex (used for the uric acid range)',
    diagnosed: 'Has a doctor diagnosed any of these?',
    diagnosedHint: 'This switches glucose and uric acid to treatment targets. You can change it later in Settings.',
    ack: 'I understand that Vitalis is a personal record, not medical advice. It does not diagnose conditions or detect emergencies, and I will talk to a doctor about my readings.',
    start: 'Start tracking',
    sample: 'Explore with sample readings'
  },

  log: {
    title: 'Log a reading',
    editTitle: 'Edit reading',
    measurement: 'Measurement',
    systolic: 'Systolic (top)',
    diastolic: 'Diastolic (bottom)',
    pulse: 'Pulse (optional)',
    unit: 'Unit',
    position: 'Position',
    hr: 'Heart rate (bpm)',
    when: 'When',
    glucose: (u: string) => `Blood glucose (${u})`,
    fastingHint: 'Fasting means no food or drink other than water for at least 8 hours.',
    uric: (u: string) => `Uric acid (${u})`,
    rulerSystolic: 'Systolic',
    rulerDiastolic: 'Diastolic',
    dateTime: 'Date and time',
    tags: 'Tags',
    notes: 'Notes',
    notesPlaceholder: 'How you felt, what you ate, symptoms, medicine taken...',
    delete: 'Delete',
    save: 'Save reading',
    saveChanges: 'Save changes',
    saved: 'Reading saved',
    savedUrgent: 'Reading saved. See the advice on Today.',
    updated: 'Reading updated',
    deleted: 'Reading deleted',
    errBoth: 'Enter both numbers from your monitor.',
    errValue: 'Enter the reading.',
    errSys: (lo: number, hi: number) => `Systolic (top number) should be between ${lo} and ${hi} mmHg.`,
    errDia: (lo: number, hi: number) => `Diastolic (bottom number) should be between ${lo} and ${hi} mmHg.`,
    errOrder: 'The top number (systolic) is normally higher than the bottom number (diastolic). Check the order.',
    errPulse: (lo: number, hi: number) => `Pulse should be between ${lo} and ${hi} bpm.`,
    errHr: (lo: number, hi: number) => `Heart rate should be between ${lo} and ${hi} bpm.`,
    errGlucoseMmol: 'Glucose should be between 0.6 and 44 mmol/L. Check the unit.',
    errGlucoseMg: 'Glucose should be between 10 and 800 mg/dL. Check the unit.',
    errUricUmol: 'Uric acid should be between 30 and 1190 µmol/L. Check the unit.',
    errUricMg: 'Uric acid should be between 0.5 and 20 mg/dL. Check the unit.',
    errDate: 'Choose a date and time.',
    errFuture: 'The date and time are in the future.'
  },

  backup: {
    notJson: 'This file is not a Vitalis backup: it is not valid JSON.',
    notBackup: 'This file is not a Vitalis backup. Choose a file exported from Settings > Back up data.',
    csvHeader: ['Date', 'Time', 'Measurement', 'Value', 'Unit', 'Pulse (bpm)', 'Context', 'Tags', 'Notes']
  },

  pdf: {
    title: 'Health measurements report',
    subject: 'Blood pressure, heart rate, blood glucose and uric acid',
    readingsFrom: (from: string, to: string, gen: string) => `Readings from ${from} to ${to}. Generated ${gen}.`,
    name: 'Name',
    age: 'Age',
    ageValue: (age: number, year: number) => `${age} (born ${year})`,
    sex: 'Sex',
    sexValue: { unspecified: 'Not given', female: 'Female', male: 'Male' },
    conditions: 'Known conditions',
    conditionNames: { hypertension: 'High blood pressure', diabetes: 'Diabetes', gout: 'Gout' },
    medications: 'Medications',
    doctor: 'Doctor',
    notGiven: 'Not given',
    noneRecorded: 'None recorded',
    targets: (list: string) => `Personal targets set by a clinician: ${list}.`,
    tBp: (s: string, d: string) => `Blood pressure below ${s}/${d} mmHg`,
    tFasting: (lo: number, hi: number) => `Fasting glucose ${lo}-${hi} mg/dL`,
    tAfter: (v: number) => `After-meal glucose below ${v} mg/dL`,
    tUric: (v: number) => `Uric acid below ${v} mg/dL`,
    summary: 'Summary',
    readingsCount: (n: number) => plural(n, 'reading', 'readings'),
    none: 'No readings in this period.',
    cols: ['Measurement', 'Readings', 'Average', 'Lowest-highest', 'In range', 'Trend / month', 'Latest'],
    tooFew: 'Too few',
    summaryNote: 'Blood pressure trend is systolic. Heart rate includes the pulse recorded with blood pressure readings.',
    trends: 'Trends',
    trendsNote: 'Dots are readings, coloured by category; the line is the 7-day average',
    bpChartNote: (s: number, d: number) => `Upper line systolic, lower line diastolic. Dashed: ${s}/${d} mmHg`,
    noReadingsChart: 'No readings in this period',
    findings: 'Findings',
    questions: 'Questions to discuss',
    questionsNote: 'Space for the answers',
    tests: 'Tests to ask about',
    testsNote: 'Bold = raised by these readings',
    whoToSee: 'Who to see',
    suggested: ' (suggested)',
    urgent: 'Get urgent care for:',
    allReadings: 'All readings',
    allReadingsNote: (n: number) => `${n} in this period, oldest first`,
    logCols: ['Date', 'Time', 'Measurement', 'Value', 'Unit', 'Category', 'Context, tags and notes'],
    footer: 'Recorded at home by the patient with Vitalis. Compared with general adult reference ranges; not a diagnosis.',
    page: (p: number, n: number) => `Page ${p} of ${n}`,
    fileName: 'Vitalis-report',
    shareTitle: 'Health measurements report'
  }
};

export type Dict = typeof en;
