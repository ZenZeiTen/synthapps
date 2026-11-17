/**
 * Bahasa Indonesia. Must have exactly the same shape as en.ts.
 * Medical terms follow common Indonesian clinical usage (tekanan darah,
 * hipertensi tahap 1, gula darah puasa, asam urat, hipoglikemia).
 */
import type { Dict } from './en';

const n = (count: number, word: string) => `${count} ${word}`;

export const id: Dict = {
  meta: {
    htmlLang: 'id',
    locale: 'id-ID',
    languageName: 'Bahasa Indonesia',
    short: 'ID',
    installName: 'Vitalis Pencatat Kesehatan',
    installDescription:
      'Catat tekanan darah, denyut jantung, gula darah, dan asam urat. Lihat tren, dapatkan penjelasan yang mudah dipahami, dan bagikan laporan PDF kepada dokter Anda.',
    shortcutLog: 'Catat pengukuran',
    shortcutLogShort: 'Catat'
  },

  common: {
    metric: { bp: 'Tekanan darah', hr: 'Denyut jantung', glucose: 'Gula darah', uric: 'Asam urat' },
    level: {
      neutral: 'Tidak dinilai',
      ok: 'Dalam rentang',
      low: 'Di bawah rentang',
      mild: 'Sedikit di atas',
      watch: 'Di atas rentang',
      high: 'Tinggi',
      urgent: 'Perlu perhatian'
    },
    glucoseContext: {
      fasting: 'Puasa',
      'before-meal': 'Sebelum makan',
      'after-meal': '1-2 jam setelah makan',
      bedtime: 'Sebelum tidur',
      random: 'Kapan saja'
    },
    hrContext: {
      resting: 'Istirahat',
      'after-waking': 'Setelah bangun tidur',
      active: 'Saat beraktivitas',
      'after-exercise': 'Setelah olahraga'
    },
    position: { sitting: 'Duduk', standing: 'Berdiri', lying: 'Berbaring' },
    positionLower: { sitting: 'duduk', standing: 'berdiri', lying: 'berbaring' },
    arm: { left: 'Lengan kiri', right: 'Lengan kanan' },
    armLower: { left: 'lengan kiri', right: 'lengan kanan' },
    pulseValue: (v: string) => `nadi ${v}`,
    tags: {
      'Took medication': 'Sudah minum obat',
      'Missed medication': 'Lupa minum obat',
      Coffee: 'Kopi',
      Exercise: 'Olahraga',
      Stressed: 'Stres',
      'Poor sleep': 'Kurang tidur',
      'Salty meal': 'Makanan asin',
      Alcohol: 'Alkohol',
      Unwell: 'Tidak enak badan',
      Pain: 'Nyeri',
      'Irregular heartbeat': 'Detak jantung tidak teratur'
    },
    readings: (c: number) => n(c, 'pengukuran'),
    today: 'Hari ini',
    yesterday: 'Kemarin',
    close: 'Tutup',
    cancel: 'Batal',
    language: 'Bahasa',
    saveOrSend: 'Simpan atau kirim',
    mainNav: 'Utama',
    noReading: 'belum ada pengukuran',
    sampleLunch: 'Makan siang nasi goreng',
    sampleRedMeat: 'Sebelum mengurangi daging merah',
    switchLanguage: 'Ganti bahasa'
  },

  ranges: {
    sys: {
      low: ['Rendah', 'Sistolik di bawah 90 mmHg sering disebut tekanan darah rendah. Hal ini terutama penting jika Anda merasa pusing, hampir pingsan, atau tidak enak badan.'],
      normal: ['Normal', 'Tekanan sistolik di bawah 120 mmHg termasuk rentang normal.'],
      elevated: ['Meningkat', 'Sistolik 120 sampai 129 mmHg disebut meningkat. Perubahan gaya hidup membantu mencegahnya naik lebih jauh.'],
      stage1: ['Rentang tahap 1', 'Sistolik 130 sampai 139 mmHg termasuk rentang hipertensi tahap 1.'],
      stage2: ['Rentang tahap 2', 'Sistolik 140 mmHg atau lebih termasuk rentang hipertensi tahap 2.'],
      severe: ['Berat', 'Sistolik di atas 180 mmHg sangat tinggi. Istirahat 5 menit lalu ukur ulang; segera cari pertolongan medis jika tetap setinggi ini atau Anda mengalami gejala.']
    },
    dia: {
      low: ['Rendah', 'Diastolik di bawah 60 mmHg sering disebut rendah. Hal ini terutama penting jika Anda mengalami gejala.'],
      normal: ['Normal', 'Tekanan diastolik di bawah 80 mmHg termasuk rentang normal.'],
      stage1: ['Rentang tahap 1', 'Diastolik 80 sampai 89 mmHg termasuk rentang hipertensi tahap 1.'],
      stage2: ['Rentang tahap 2', 'Diastolik 90 mmHg atau lebih termasuk rentang hipertensi tahap 2.'],
      severe: ['Berat', 'Diastolik di atas 120 mmHg sangat tinggi. Ukur ulang setelah istirahat; segera cari pertolongan medis jika tetap setinggi ini atau Anda mengalami gejala.']
    },
    bpAboveTarget: 'Di atas target Anda',
    bpAboveTargetDetail: (max: number, which: 'systolic' | 'diastolic') =>
      `Target dari dokter Anda adalah ${which === 'systolic' ? 'sistolik' : 'diastolik'} di bawah ${max} mmHg.`,
    bpLow: ['Rendah', 'Di bawah 90/60 mmHg sering disebut tekanan darah rendah. Hal ini terutama penting jika Anda merasa pusing, hampir pingsan, atau tidak enak badan.'],
    bpSevere: [
      'Berat',
      'Di atas 180/120 mmHg sangat tinggi. Istirahat 5 menit lalu ukur ulang. Hubungi layanan gawat darurat jika Anda mengalami nyeri dada, sesak napas, nyeri punggung, mati rasa, lemah, sulit berbicara, atau gangguan penglihatan.'
    ],
    hr: {
      veryLow: ['Sangat lambat', 'Denyut jantung saat istirahat di bawah 40 bpm perlu segera diperiksakan, terutama jika disertai pusing, pingsan, atau lelah.'],
      low: ['Lambat', '40 sampai 59 bpm saat istirahat disebut bradikardia. Hal ini sering normal pada orang yang bugar dan saat tidur; perlu diperhatikan jika ada gejala.'],
      normal: ['Normal', '60 sampai 100 bpm adalah rentang denyut istirahat yang umum pada orang dewasa.'],
      high: ['Cepat', 'Di atas 100 bpm saat istirahat disebut takikardia. Kafein, stres, demam, atau kurang minum bisa menjadi penyebabnya; hasil yang berulang perlu dibicarakan dengan dokter.'],
      veryHigh: ['Sangat cepat', 'Denyut istirahat di atas 120 bpm jauh di atas rentang. Segera periksakan diri jika berlangsung terus atau disertai nyeri dada, sesak napas, atau pingsan.'],
      notResting: ['Tidak saat istirahat', 'Denyut jantung saat atau setelah beraktivitas tidak dibandingkan dengan rentang istirahat.']
    },
    glucose: {
      veryLow: ['Sangat rendah', 'Di bawah 54 mg/dL (3,0 mmol/L) adalah hipoglikemia tingkat 2. Segera konsumsi gula yang cepat diserap dan ikuti rencana perawatan Anda; minta bantuan jika tidak bisa menanganinya sendiri.'],
      low: ['Rendah', 'Di bawah 70 mg/dL (3,9 mmol/L) termasuk rendah. Konsumsi 15 g gula yang cepat diserap, lalu periksa ulang setelah 15 menit.'],
      belowTarget: 'Di bawah target',
      belowTargetDetail: (min: number) => `Target sebelum makan Anda dimulai dari ${min} mg/dL.`,
      inTarget: 'Sesuai target',
      inTargetBeforeDetail: (min: number, max: number) => `Sesuai target sebelum makan Anda, ${min} sampai ${max} mg/dL.`,
      inTargetAfterDetail: (max: number) => `Di bawah target setelah makan Anda, ${max} mg/dL.`,
      aboveTarget: 'Di atas target',
      aboveTargetBeforeDetail: (max: number) => `Di atas target sebelum makan Anda, ${max} mg/dL.`,
      aboveTargetAfterDetail: (max: number) => `Sama dengan atau di atas target setelah makan Anda, ${max} mg/dL.`,
      high: 'Tinggi',
      highBeforeDetail: 'Jauh di atas target sebelum makan. Ikuti rencana perawatan Anda untuk hasil yang tinggi.',
      highAfterDetail: 'Jauh di atas target. Ikuti rencana perawatan Anda untuk hasil yang tinggi.',
      veryHigh: 'Sangat tinggi',
      veryHighDiabetesDetail:
        'Sangat tinggi. Periksa keton jika rencana perawatan Anda memintanya, minum air, dan hubungi tim perawatan Anda; segera cari pertolongan medis jika muntah, mengantuk berat, atau napas cepat.',
      veryHighDetail: 'Sangat tinggi. Hubungi dokter hari ini; segera cari pertolongan medis jika muntah, sangat haus, mengantuk berat, atau bingung.',
      fastingNormal: ['Normal', 'Gula darah puasa 70 sampai 99 mg/dL termasuk rentang normal.'],
      prediabetes: ['Rentang prediabetes', 'Gula darah puasa 100 sampai 125 mg/dL termasuk rentang prediabetes. Tes laboratorium diperlukan untuk memastikannya.'],
      diabetesRange: ['Rentang diabetes', 'Gula darah puasa 126 mg/dL atau lebih termasuk rentang diabetes. Diagnosis memerlukan tes laboratorium, biasanya diulang.'],
      otherNormal: ['Normal', 'Di bawah 140 mg/dL adalah rentang yang umum di luar puasa.'],
      aboveUsual: ['Di atas biasanya', '140 sampai 199 mg/dL setelah makan lebih tinggi dari biasanya dan perlu diperiksa dengan tes laboratorium.'],
      otherHigh: ['Tinggi', '200 mg/dL atau lebih termasuk tinggi. Jika disertai gejala seperti sering haus atau sering buang air kecil, bisa mengarah ke diabetes; temui dokter.']
    },
    uric: {
      below: ['Di bawah rentang', 'Di bawah rentang yang umum. Jarang menjadi masalah tersendiri; sampaikan ke dokter jika terus terjadi.'],
      normal: 'Normal',
      inTarget: 'Sesuai target',
      targetDetail: (target: string) => `Di bawah target Anda, ${target} mg/dL. Menjaga asam urat di bawah target membantu kristal gout larut seiring waktu.`,
      rangeDetail: (low: string, high: string) => `Dalam rentang umum sekitar ${low} sampai ${high} mg/dL. Setiap laboratorium sedikit berbeda.`,
      aboveTarget: 'Di atas target',
      aboveTargetDetail: (target: string) => `Sama dengan atau di atas target Anda, ${target} mg/dL.`,
      aboveRange: 'Di atas rentang',
      aboveRangeDetail: 'Di atas rentang umum (hiperurisemia). Di atas sekitar 6,8 mg/dL, kristal urat dapat terbentuk di sendi.',
      wellAbove: ['Jauh di atas rentang', '9 mg/dL atau lebih jauh di atas rentang dan meningkatkan risiko serangan gout dan batu ginjal.']
    }
  },

  insights: {
    period: (days: number) => (days > 0 ? `${days} hari terakhir` : 'semua pengukuran Anda'),
    scope: { bp: 'Tekanan darah', hr: 'Denyut jantung', glucose: 'Gula darah', uric: 'Asam urat', general: 'Umum' },
    bpAverage: (avg: string, label: string) => `Rata-rata ${avg} mmHg: ${label}`,
    bpAverageBody: (c: number, period: string, detail: string) => `Dari ${n(c, 'pengukuran')} dalam ${period}. ${detail}`,
    bpFew: 'Lebih banyak pengukuran memberi gambaran yang lebih jelas',
    bpFewBody:
      'Dokter menilai tekanan darah di rumah dari rata-rata banyak pengukuran. Cara yang umum: dua kali pengukuran berjarak satu menit, pagi dan malam, selama 7 hari, dalam posisi duduk dengan punggung bersandar dan kaki menapak setelah istirahat 5 menit.',
    bpSevere: (c: number) => `${n(c, 'pengukuran')} di atas 180/120 mmHg`,
    bpSevereBody:
      'Hasil setinggi ini perlu segera diperiksakan ke dokter, walaupun tanpa gejala. Jika disertai nyeri dada, sesak napas, nyeri punggung, mati rasa, lemah, sulit berbicara, atau gangguan penglihatan, segera hubungi layanan gawat darurat.',
    bpLow: (c: number) => `${n(c, 'pengukuran')} dengan sistolik di bawah 90 mmHg`,
    bpLowBody: 'Hasil rendah terutama penting jika Anda merasa pusing, melayang, atau hampir pingsan, apalagi saat berdiri. Catat gejala bersama hasilnya.',
    bpRising: (v: string) => `Tekanan sistolik naik sekitar ${v} mmHg per bulan`,
    bpRisingBody: 'Garis tren pengukuran Anda naik. Perubahan obat, garam, tidur, stres, atau berat badan dapat berperan.',
    bpFalling: (v: string) => `Tekanan sistolik turun sekitar ${v} mmHg per bulan`,
    bpFallingBody: 'Garis tren pengukuran Anda turun. Jika Anda juga merasa pusing, sampaikan ke dokter karena obat mungkin perlu disesuaikan.',
    bpMorning: (d: string) => `Pagi hari ${d} mmHg lebih tinggi daripada malam`,
    bpMorningBody: (am: string, pm: string) =>
      `Rata-rata sistolik pagi ${am} mmHg, malam ${pm} mmHg. Tekanan pagi yang lebih tinggi perlu disampaikan ke dokter; waktu minum obat terkadang bisa membantu.`,
    bpEvening: (d: string) => `Malam hari ${d} mmHg lebih tinggi daripada pagi`,
    bpEveningBody: (am: string, pm: string) =>
      `Rata-rata sistolik malam ${pm} mmHg, pagi ${am} mmHg. Aktivitas, makanan, garam, dan stres sepanjang hari dapat menaikkan hasil malam.`,
    bpArms: (d: string) => `Lengan kiri dan kanan berbeda ${d} mmHg`,
    bpArmsBody: 'Perbedaan sistolik lebih dari 10 mmHg antara kedua lengan perlu disampaikan ke dokter. Ukurlah di lengan dengan hasil yang lebih tinggi.',
    bpVariable: 'Hasil pengukuran sangat bervariasi',
    bpVariableBody: (sd: string) =>
      `Sistolik Anda naik-turun sekitar ${sd} mmHg dari rata-rata. Mengukur dengan cara yang sama setiap kali (lengan yang sama, setelah istirahat 5 menit, tanpa kopi atau olahraga 30 menit sebelumnya) membuat hasil lebih mudah dibandingkan.`,
    bpPulsePressure: (v: string) => `Selisih kedua angka besar (${v} mmHg)`,
    bpPulsePressureBody:
      'Selisih antara tekanan sistolik dan diastolik (tekanan nadi) rata-rata 60 mmHg atau lebih. Hal ini umum seiring usia dan pembuluh darah yang lebih kaku, dan perlu disampaikan ke dokter.',

    hrAverage: (v: string, label: string) => `Rata-rata denyut istirahat ${v} bpm: ${label}`,
    hrAverageBody: (c: number, period: string, detail: string) =>
      `Dari ${n(c, 'pengukuran saat istirahat')} dalam ${period}, termasuk nadi dari pengukuran tekanan darah. ${detail}`,
    hrHigh: (c: number) => `${n(c, 'pengukuran saat istirahat')} di atas 100 bpm`,
    hrHighBody: 'Denyut cepat saat istirahat punya banyak penyebab, mulai dari kafein, demam, dan kurang minum hingga gangguan tiroid atau irama jantung. Catat bagaimana kondisi Anda saat itu.',
    hrLow: (c: number) => `${n(c, 'pengukuran saat istirahat')} di bawah 50 bpm`,
    hrLowBody:
      'Denyut lambat sering normal pada orang yang bugar. Perlu diperiksakan jika Anda merasa pusing, lelah, sesak napas, atau hampir pingsan, atau minum obat yang memperlambat jantung.',
    hrIrregular: (c: number) => `Detak jantung tidak teratur tercatat ${c} kali`,
    hrIrregularBody: 'Banyak alat menampilkan simbol saat irama tidak teratur. Hasil tidak teratur yang berulang bisa menjadi tanda fibrilasi atrium dan perlu diperiksa dengan EKG.',
    hrRising: (v: string) => `Denyut istirahat naik sekitar ${v} bpm per bulan`,
    hrRisingBody: 'Denyut istirahat yang naik bisa terjadi setelah sakit, kurang tidur, stres, kurang aktif, atau perubahan obat.',
    hrFalling: (v: string) => `Denyut istirahat turun sekitar ${v} bpm per bulan`,
    hrFallingBody: 'Denyut istirahat yang turun sering menandakan kebugaran yang membaik. Jika Anda merasa lelah atau pusing, sampaikan ke dokter.',

    glucoseFasting: (diabetes: boolean, v: string, label: string) => `Rata-rata gula darah ${diabetes ? 'puasa dan sebelum makan' : 'puasa'} ${v}: ${label}`,
    glucoseFastingBody: (c: number, period: string, detail: string) => `Dari ${n(c, 'pengukuran')} dalam ${period}. ${detail}`,
    glucoseAfter: (v: string, label: string) => `Rata-rata gula darah setelah makan ${v}: ${label}`,
    glucoseAfterBody: (c: number, detail: string) => `Dari ${n(c, 'pengukuran')} 1 sampai 2 jam setelah makan. ${detail}`,
    glucoseRandom: (v: string) => `Rata-rata gula darah ${v}`,
    glucoseRandomBody:
      'Tandai pengukuran sebagai puasa, sebelum makan, atau setelah makan. Pengukuran puasa, setelah minimal 8 jam tanpa makan, paling mudah dibandingkan dengan rentang acuan.',
    glucoseLows: (c: number, v: string) => `${n(c, 'pengukuran rendah')} di bawah ${v}`,
    glucoseLowsBody: (veryLow: number, v54: string) =>
      `${veryLow ? `${n(veryLow, 'pengukuran')} di bawah ${v54}, yang termasuk gula darah rendah serius. ` : ''}Atasi gula rendah dengan 15 g gula yang cepat diserap, periksa ulang setelah 15 menit, dan sampaikan ke dokter seberapa sering hal ini terjadi.`,
    glucoseVeryHigh: (c: number, v: string) => `${n(c, 'pengukuran')} ${v} atau lebih`,
    glucoseVeryHighBody: 'Gula darah sangat tinggi perlu segera diperiksakan ke dokter. Segera cari pertolongan medis jika disertai muntah, sakit perut, napas cepat, mengantuk berat, atau bingung.',
    glucoseInTarget: (pct: string) => `${pct}% pengukuran sesuai target`,
    glucoseInTargetBody:
      'Ini menghitung pengukuran yang Anda catat, yang mungkin tidak mewakili sepanjang hari. Alat pemantau glukosa berkelanjutan (CGM) menargetkan lebih dari 70% waktu dalam sehari berada di 70 sampai 180 mg/dL.',
    glucoseSwings: 'Gula darah sangat naik-turun',
    glucoseSwingsBody: (pct: string) => `Pengukuran Anda bervariasi ${pct}% dari rata-rata. Lebih dari 36% dianggap variabilitas tinggi dan meningkatkan kemungkinan gula darah rendah.`,
    glucoseA1c: (v: string) => `Rata-rata Anda memperkirakan HbA1c sekitar ${v}%`,
    glucoseA1cBody: (c: number, avg: string) =>
      `Perkiraan kasar dari rata-rata ${n(c, 'pengukuran')} (${avg}), dengan rumus ADAG. Pengukuran sesekali tidak mencakup sebagian besar hari, jadi tes HbA1c di laboratorium adalah angka yang dapat diandalkan.`,

    uricLatest: (v: string, label: string) => `Asam urat terakhir ${v}: ${label}`,
    uricLatestAverage: (c: number, v: string) => `Rata-rata ${n(c, 'pengukuran')}: ${v}. `,
    uricRising: (v: string) => `Asam urat naik sekitar ${v} per bulan`,
    uricRisingBody: 'Makanan tinggi purin (jeroan, sebagian makanan laut), alkohol, minuman manis, kurang minum, dan beberapa obat dapat menaikkan asam urat.',
    uricFalling: (v: string) => `Asam urat turun sekitar ${v} per bulan`,
    uricFallingBody: 'Kadar yang turun adalah tanda baik jika Anda sedang berusaha menurunkannya.',
    uricTips: 'Cara menurunkan asam urat',
    uricTipsBody:
      'Minum air yang cukup, batasi alkohol (terutama bir) dan minuman manis, kurangi daging merah, jeroan, dan kerang-kerangan, serta jaga berat badan ideal. Tanyakan dulu ke dokter sebelum menghentikan obat yang mungkin menaikkan asam urat.',

    empty: 'Tidak ada pengukuran dalam periode ini',
    emptyBody: 'Catat pengukuran untuk melihat rata-rata, tren, dan artinya.'
  },

  questions: {
    'bp.confirm': (avg: string) =>
      `Rata-rata tekanan darah saya di rumah ${avg} mmHg. Apakah ini berarti saya mengalami hipertensi, atau perlukah pemantauan 24 jam untuk memastikannya?`,
    'bp.target': 'Berapa target tekanan darah yang tepat untuk saya, dan perubahan gaya hidup apa yang paling berpengaruh?',
    'bp.treatment': 'Hasil saya masih di atas target dengan pengobatan sekarang. Apakah dosis, jenis obat, atau waktu minumnya perlu diubah?',
    'bp.severe': 'Saya pernah mendapat hasil di atas 180/120. Apa yang harus saya lakukan jika terjadi lagi, dan kapan saya harus ke IGD?',
    'bp.morning': 'Hasil pagi saya lebih tinggi daripada malam. Apakah minum obat di waktu lain akan membantu?',
    'bp.low': 'Kadang hasil saya rendah. Mungkinkah ini karena obat saya, dan apa yang harus saya lakukan jika merasa pusing?',
    'bp.arms': 'Hasil di kedua lengan saya berbeda lebih dari 10 mmHg. Apakah perlu pemeriksaan lebih lanjut?',
    'bp.rising': 'Tekanan darah saya terus naik. Apa kemungkinan penyebabnya?',
    'bp.monitor': 'Bisakah kita mencocokkan alat ukur saya di rumah dengan hasil di klinik untuk memastikan alatnya akurat?',
    'hr.high': 'Denyut istirahat saya sering di atas 100. Mungkinkah karena gangguan tiroid, anemia, kafein, atau gangguan irama jantung? Apakah saya perlu EKG?',
    'hr.low': 'Denyut jantung saya sering di bawah 50. Apakah ini normal bagi saya, atau mungkinkah ada obat yang memperlambatnya?',
    'hr.irregular': 'Alat saya menunjukkan detak jantung tidak teratur. Apakah saya perlu diperiksa untuk fibrilasi atrium?',
    'hr.target': 'Berapa denyut istirahat yang sebaiknya saya capai, dan gejala apa saja dengan nadi cepat atau lambat yang mengharuskan saya menghubungi dokter?',
    'glucose.prediabetes': 'Beberapa hasil gula darah saya masuk rentang prediabetes. Perlukah saya tes HbA1c atau tes toleransi glukosa?',
    'glucose.risk': 'Apa yang bisa saya lakukan untuk menurunkan risiko diabetes tipe 2?',
    'glucose.diabetesRange': 'Hasil gula darah saya masuk rentang diabetes. Tes apa yang memastikannya, dan apa langkah selanjutnya?',
    'glucose.aboveTarget': 'Hasil saya sering di atas target. Apakah target saya masih tepat, dan perlukah pengobatan saya diubah?',
    'glucose.ketones': 'Kapan saya harus memeriksa keton, dan apa yang harus dilakukan jika hasilnya tinggi?',
    'glucose.lows': (c: number) => `Saya mengalami ${n(c, 'kali gula darah rendah')}. Bagaimana saya mengatur makanan, aktivitas, atau obat untuk mencegahnya?`,
    'glucose.glucagon': 'Perlukah saya membawa glukagon, dan apakah orang di sekitar saya perlu tahu cara menggunakannya?',
    'glucose.cgm': 'Gula darah saya sangat naik-turun. Apakah alat pemantau glukosa berkelanjutan (CGM) akan membantu?',
    'glucose.frequency': 'Seberapa sering, dan pada jam berapa, saya sebaiknya memeriksa gula darah?',
    'uric.goutTreatment': 'Asam urat saya di atas target. Apakah dosis obat penurun asam urat perlu dinaikkan agar di bawah 6 mg/dL?',
    'uric.treatment': 'Asam urat saya di atas rentang normal. Apakah saya perlu pengobatan, atau cukup dengan perubahan pola makan dan gaya hidup dulu?',
    'uric.medicines': 'Mungkinkah ada obat saya, misalnya obat diuretik atau aspirin dosis rendah, yang menaikkan asam urat?',
    'uric.kidneys': 'Apakah fungsi ginjal saya perlu diperiksa, dan apakah saya berisiko batu ginjal?',
    'uric.flare': 'Bagaimana cara menangani serangan gout selama saya menjalani pengobatan?',
    'uric.retest': 'Seberapa sering asam urat saya perlu diperiksa ulang?',
    'general.medicines': 'Apakah ada obat atau suplemen saya yang memengaruhi angka-angka ini?',
    'general.tracking': 'Pengukuran mana yang sebaiknya terus saya catat, dan seberapa sering?'
  },

  labs: {
    'bp.abpm': ['Pemantauan tekanan darah 24 jam (ABPM)', 'Memastikan apakah tekanan darah tinggi sepanjang siang dan malam, dan menyingkirkan efek "jas putih".'],
    'bp.kidney': ['Fungsi ginjal dan elektrolit (kreatinin, eGFR, natrium, kalium)', 'Hipertensi dapat memengaruhi ginjal, dan beberapa obat tekanan darah mengubah kadar kalium.'],
    'bp.uacr': ['Rasio albumin-kreatinin urine (UACR) dan urinalisis', 'Mendeteksi sedikit protein dalam urine, tanda awal beban pada ginjal.'],
    'bp.lipids': ['Profil lipid (kolesterol)', 'Tekanan darah dan kolesterol bersama-sama menentukan risiko penyakit jantung dan stroke.'],
    'bp.glucose': ['Gula darah puasa atau HbA1c', 'Diabetes dan hipertensi sering terjadi bersamaan.'],
    'bp.tsh': ['Fungsi tiroid (TSH)', 'Tiroid yang terlalu aktif atau kurang aktif dapat menaikkan tekanan darah.'],
    'bp.ecg': ['EKG 12 sadapan', 'Menunjukkan apakah hipertensi telah membebani jantung.'],
    'bp.aldo': [
      'Rasio aldosteron-renin',
      'Skrining aldosteronisme primer, penyebab hormonal hipertensi yang mudah terlewat, terutama jika tekanan darah tetap tinggi meski diobati atau kalium rendah.'
    ],
    'hr.ecg': ['EKG 12 sadapan', 'Merekam irama jantung dan menunjukkan gangguan hantaran listrik jantung.'],
    'hr.holter': ['Holter atau event monitor (24 jam hingga 2 minggu)', 'Menangkap perubahan irama yang datang dan pergi.'],
    'hr.thyroid': ['Fungsi tiroid (TSH, T4 bebas)', 'Gangguan tiroid sering mempercepat atau memperlambat jantung.'],
    'hr.fbc': ['Darah lengkap', 'Anemia dapat membuat jantung berdetak lebih cepat.'],
    'hr.electrolytes': ['Elektrolit (kalium, magnesium)', 'Kadar yang terlalu rendah atau tinggi dapat mengganggu irama jantung.'],
    'glucose.a1c': ['HbA1c', 'Menunjukkan rata-rata gula darah 2 sampai 3 bulan terakhir; 5,7-6,4% termasuk rentang prediabetes dan 6,5% atau lebih rentang diabetes.'],
    'glucose.fpg': ['Gula darah puasa (laboratorium)', 'Pengukuran laboratorium lebih akurat daripada alat di rumah.'],
    'glucose.ogtt': ['Tes toleransi glukosa oral (TTGO)', 'Menunjukkan cara tubuh mengolah minuman gula dengan takaran tertentu selama 2 jam.'],
    'glucose.lipidsKidney': [
      'Profil lipid dan tes ginjal (eGFR, UACR)',
      'Memeriksa risiko jantung dan ginjal yang meningkat bila gula darah tinggi; dianjurkan minimal setahun sekali pada diabetes.'
    ],
    'glucose.alt': ['Enzim hati (SGPT/ALT)', 'Gula darah yang tinggi sering disertai perlemakan hati.'],
    'glucose.eyesFeet': ['Pemeriksaan mata (dengan pelebaran pupil) dan kaki', 'Pemeriksaan tahunan untuk perubahan mata dan saraf akibat diabetes.'],
    'glucose.cpeptide': ['C-peptida dan autoantibodi sel islet', 'Membantu membedakan diabetes tipe 1 dan tipe 2 jika tipenya belum jelas.'],
    'uric.repeat': ['Ulang pemeriksaan asam urat darah', 'Satu kali pengukuran bisa menyesatkan. Saat serangan gout, asam urat bisa tampak normal palsu, jadi ulangi sekitar 2 minggu setelah serangan reda.'],
    'uric.kidney': ['Fungsi ginjal (kreatinin, eGFR) dan urinalisis', 'Ginjal membuang asam urat, dan kadar yang tinggi dapat menyebabkan batu ginjal.'],
    'uric.metabolic': ['Profil lipid, gula darah, dan HbA1c', 'Asam urat tinggi sering disertai kolesterol, gula darah, dan tekanan darah yang meningkat.'],
    'uric.liver': ['Tes fungsi hati dan darah lengkap', 'Diperiksa sebelum dan selama pengobatan penurun asam urat.'],
    'uric.crystals': ['Pemeriksaan cairan sendi untuk kristal', 'Memastikan gout jika sendi terasa panas, merah, dan bengkak.'],
    'uric.hla': [
      'Tes HLA-B*5801',
      'Dianjurkan sebelum memulai allopurinol pada orang keturunan Asia Tenggara (misalnya Tionghoa Han, Korea, atau Thailand) atau Afrika, yang lebih berisiko mengalami reaksi kulit berat.'
    ],
    'uric.urine24': ['Asam urat urine 24 jam', 'Berguna jika Anda pernah mengalami batu ginjal.']
  },

  specialists: {
    gp: ['Dokter umum atau dokter spesialis penyakit dalam', 'Tempat pertama untuk semua pengukuran ini. Dokter dapat meminta tes di atas, memulai pengobatan, dan merujuk Anda.'],
    cardiologist: [
      'Dokter spesialis jantung (kardiolog)',
      'Tekanan darah yang tetap tinggi dengan tiga obat atau lebih, EKG yang tidak normal, jantung berdebar, detak jantung tidak teratur atau terus-menerus cepat atau lambat, atau nyeri dada.'
    ],
    ep: ['Dokter spesialis jantung konsultan aritmia (elektrofisiologi)', 'Gangguan irama jantung yang sudah dipastikan, seperti fibrilasi atrium, yang memerlukan penanganan khusus.'],
    endocrinologist: [
      'Dokter spesialis penyakit dalam konsultan endokrin',
      'Diabetes yang belum mencapai target, gula darah sering rendah, dugaan diabetes tipe 1, gangguan tiroid, atau dugaan penyebab hormonal hipertensi.'
    ],
    nephrologist: [
      'Dokter spesialis penyakit dalam konsultan ginjal-hipertensi',
      'Fungsi ginjal yang menurun, protein dalam urine, tekanan darah yang sulit dikendalikan, atau batu ginjal disertai asam urat tinggi.'
    ],
    rheumatologist: ['Dokter spesialis penyakit dalam konsultan reumatologi', 'Serangan gout, benjolan kristal di bawah kulit (tofus), atau asam urat yang tetap di atas target meski diobati.'],
    dietitian: ['Ahli gizi atau edukator diabetes', 'Bantuan menyusun pola makan untuk menurunkan garam, gula darah, atau asam urat, serta cara memakai alat ukur atau insulin.']
  },

  emergency: [
    'Tekanan darah di atas 180/120 mmHg disertai nyeri dada, sesak napas, nyeri punggung, mati rasa atau lemah, sulit berbicara, atau gangguan penglihatan.',
    'Nyeri atau rasa tertekan di dada, pingsan, atau detak jantung sangat cepat atau sangat lambat disertai pusing atau sesak napas.',
    'Gula darah di bawah 54 mg/dL (3,0 mmol/L) yang tidak naik setelah ditangani, atau bingung, kejang, atau tidak sadar.',
    'Gula darah di atas 300 mg/dL (16,7 mmol/L) disertai muntah, sakit perut, napas cepat, napas berbau buah, atau mengantuk berat.',
    'Sendi yang panas, merah, dan sangat nyeri disertai demam, yang bisa jadi infeksi dan bukan gout.'
  ],

  nav: {
    today: 'Hari ini',
    trends: 'Tren',
    journal: 'Catatan',
    insights: 'Wawasan',
    report: 'Laporan',
    settings: 'Pengaturan',
    logReading: 'Catat pengukuran',
    railFoot: 'Hanya tersimpan di perangkat ini. Bukan nasihat medis.',
    reportAria: 'Laporan untuk dokter Anda',
    updateReady: 'Versi baru Vitalis sudah siap',
    reload: 'Muat ulang',
    undo: 'Urungkan'
  },

  today: {
    greeting: (h: number, name: string) => {
      const part = h < 4 ? 'Selamat malam' : h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
      return name ? `${part}, ${name}` : part;
    },
    summary: (week: number, streak: number) =>
      `${n(week, 'pengukuran')} minggu ini${streak > 1 ? `, tercatat ${streak} hari berturut-turut` : ''}.`,
    firstReading: 'Catat pengukuran pertama Anda untuk mulai melihat tren.',
    urgentCare: 'Kapan harus segera ke fasilitas kesehatan',
    standsOut: 'Yang perlu diperhatikan',
    allInsights: 'Semua wawasan',
    nothingStandsOut: 'Tidak ada yang perlu diperhatikan dalam 30 hari terakhir.',
    doctorSoon: 'Akan ke dokter?',
    doctorSoonBody: 'Buat PDF berisi rata-rata, grafik, temuan, dan pertanyaan yang ingin Anda ajukan. Bisa dibuka di ponsel atau komputer apa pun dan rapi saat dicetak.',
    makeReport: 'Buat laporan',
    noReadings: 'Belum ada pengukuran.',
    add: (what: string) => `Tambah ${what}`,
    addWhat: { bp: 'tekanan darah', hr: 'denyut jantung', glucose: 'gula darah', uric: 'asam urat' },
    openTrends: (metric: string) => `${metric}: buka tren`,
    pulse: (v: number) => `Nadi ${v} bpm`,
    systolic: 'Sistolik',
    diastolic: 'Diastolik'
  },

  trends: {
    title: 'Tren',
    intro: 'Setiap titik adalah satu pengukuran, diberi warna sesuai artinya. Garis tebal adalah rata-rata 7 hari.',
    periods: { 7: '7 hari', 30: '30 hari', 90: '90 hari', 365: 'Setahun', 0: 'Semua' },
    measurement: 'Pengukuran',
    period: 'Periode',
    glucoseShow: 'Pengukuran gula darah yang ditampilkan',
    allReadings: 'Semua pengukuran',
    systolic: 'sistolik',
    diastolic: 'diastolik',
    bpLine: (s: number) => `sistolik ${s}`,
    diaLine: (d: number) => `diastolik ${d}`,
    legendBpAverage: 'Rata-rata 7 hari (atas: sistolik, bawah: diastolik)',
    legendThresholds: 'Batas tahap 1',
    legendAverage: 'Rata-rata 7 hari',
    legendRange: 'Rentang umum',
    legendBeforeMealTarget: 'Target sebelum makan',
    legendUsualOutsideFasting: 'Rentang umum di luar puasa',
    average: 'Rata-rata',
    lowHigh: 'Terendah hingga tertinggi',
    inRange: 'Dalam rentang',
    trendMonth: 'Tren per bulan',
    needsMore: 'Perlu 5+ pengukuran dalam seminggu',
    howTheyFall: 'Sebaran pengukuran',
    tod: [
      ['Pagi', '04.00-11.00'],
      ['Siang', '11.00-17.00'],
      ['Malam', '17.00-24.00'],
      ['Dini hari', '00.00-04.00']
    ],
    readings: 'Pengukuran',
    seeAll: (c: number) => `Lihat semua ${c}`,
    noneInPeriod: (metric: string) => `Tidak ada pengukuran ${metric} dalam periode ini.`,
    chartAria: (series: string, c: number, canOpen: boolean) =>
      `Grafik ${series}, ${n(c, 'pengukuran')}. Gunakan tombol panah untuk berpindah antar-pengukuran${canOpen ? ' dan Enter untuk membukanya' : ''}.`,
    chartAnd: ' dan ',
    chartEmpty: 'Tidak ada pengukuran dalam periode ini'
  },

  journal: {
    title: 'Catatan',
    intro: 'Semua pengukuran, yang terbaru di atas. Pilih salah satu untuk mengubah atau menghapusnya.',
    show: 'Tampilkan',
    all: 'Semua',
    search: 'Cari catatan dan tag',
    emptyTitle: 'Catatan Anda masih kosong',
    emptyBody: 'Pengukuran yang Anda catat akan muncul di sini beserta tanggal, waktu, keterangan, dan catatannya.',
    noMatch: 'Tidak ada pengukuran yang cocok. Coba filter atau kata pencarian lain.',
    older: 'Tampilkan pengukuran lebih lama',
    editAria: (metric: string, value: string, unit: string, label: string) => `${metric} ${value} ${unit}, ${label}. Ubah`
  },

  insightsPage: {
    title: 'Wawasan',
    intro: 'Apa arti pengukuran Anda, apa yang perlu ditanyakan, tes apa yang bisa dipertimbangkan, dan dokter mana yang perlu ditemui. Ini informasi umum untuk dibicarakan dengan tenaga kesehatan, bukan diagnosis.',
    periods: { 30: '30 hari', 90: '90 hari', 365: 'Setahun', 0: 'Semua' },
    findings: 'Temuan',
    questions: 'Pertanyaan untuk dokter Anda',
    copy: 'Salin',
    copied: (c: number) => `${c} pertanyaan disalin`,
    copyBlocked: 'Penyalinan diblokir di sini. Gunakan laporan sebagai gantinya.',
    questionsHint: 'Pertanyaan yang dicentang masuk ke laporan PDF Anda. Pertanyaan bertanda "dari pengukuran Anda" muncul karena angka Anda sendiri.',
    yourQuestion: 'Pertanyaan Anda',
    fromReadings: ', dari pengukuran Anda',
    removeQuestion: 'Hapus pertanyaan',
    included: 'Disertakan',
    addQuestion: 'Tambahkan pertanyaan Anda sendiri',
    add: 'Tambah',
    urgentTitle: 'Kapan harus segera ke fasilitas kesehatan',
    urgentIntro:
      'Hubungi nomor darurat (112, atau 119 untuk layanan ambulans dan gawat darurat kesehatan di Indonesia) atau segera ke IGD jika Anda mengalami:',
    tests: 'Tes yang bisa ditanyakan',
    showFewer: 'Tampilkan lebih sedikit',
    showAll: (c: number) => `Tampilkan semua ${c}`,
    worthAsking: 'Layak ditanyakan',
    noTests: 'Catat pengukuran untuk melihat tes yang berkaitan.',
    noSuggestedTests: 'Tidak ada pengukuran Anda yang mengarah ke tes tertentu. Pilih "Tampilkan semua" untuk melihat tes yang biasanya berkaitan dengan pengukuran ini.',
    doctors: 'Dokter yang perlu ditemui',
    suggestedNow: 'Disarankan sekarang',
    disclaimer:
      'Vitalis membandingkan pengukuran dengan rentang acuan dewasa yang dipublikasikan (kategori tekanan darah ACC/AHA, kriteria dan target gula darah ADA, rentang laboratorium umum untuk asam urat, dan target gout ACR). Akurasi alat di rumah berbeda-beda, dan rentang bergantung pada usia, kehamilan, riwayat kesehatan, dan laboratorium. Hanya tenaga kesehatan yang berwenang yang dapat mendiagnosis atau mengubah pengobatan.'
  },

  reportPage: {
    title: 'Laporan untuk dokter Anda',
    intro: 'PDF berisi pengukuran Anda untuk konsultasi, pendapat kedua, atau arsip pribadi. Data Anda tetap di perangkat ini sampai Anda membagikan berkasnya.',
    period: 'Periode',
    periods: { 30: '30 hari terakhir', 90: '90 hari terakhir', 180: '6 bulan terakhir', 365: 'Setahun terakhir', 0: 'Semua pengukuran' },
    include: 'Sertakan',
    sections: {
      summary: ['Tabel ringkasan', 'Rata-rata, rentang, dan tren tiap pengukuran'],
      charts: ['Grafik', 'Satu grafik untuk tiap pengukuran'],
      insights: ['Temuan', 'Arti pengukuran dalam bahasa sehari-hari'],
      questions: ['Pertanyaan', 'Pertanyaan yang dicentang di halaman Wawasan, dengan ruang untuk jawaban'],
      tests: ['Tes dan dokter', 'Tes yang bisa ditanyakan, dokter yang perlu ditemui, dan kapan harus segera ke fasilitas kesehatan'],
      log: ['Semua pengukuran', 'Tabel semua pengukuran beserta catatannya']
    },
    download: 'Unduh PDF',
    making: 'Membuat PDF...',
    share: 'Bagikan PDF',
    csv: 'Ekspor CSV',
    none: 'Belum ada pengukuran dalam periode ini.',
    downloaded: 'Laporan diunduh',
    shared: 'Laporan siap disimpan atau dikirim',
    failed: (msg: string) => `Laporan tidak dapat dibuat: ${msg}`,
    patient: 'Data pasien di laporan',
    noName: 'Tanpa nama',
    born: (y: number) => `, lahir ${y}`,
    medications: (m: string) => `Obat: ${m}.`,
    noMedications: 'Belum ada obat yang dicatat.',
    editProfile: 'Ubah profil',
    footnote: (from: string, to: string, findings: number, questions: number) =>
      `Rata-rata untuk ${from} sampai ${to}. Laporan juga memuat ${n(findings, 'temuan')} dan ${n(questions, 'pertanyaan')}.`,
    reportLanguage: 'Laporan ditulis dalam bahasa aplikasi. Ganti bahasa untuk membuatnya dalam bahasa Inggris atau Indonesia.'
  },

  settingsPage: {
    title: 'Pengaturan',
    intro: 'Profil Anda menyesuaikan rentang yang dipakai untuk wawasan dan muncul di laporan. Semuanya hanya tersimpan di perangkat ini.',
    profile: 'Profil',
    name: 'Nama',
    birthYear: 'Tahun lahir',
    sex: 'Jenis kelamin',
    sexOptions: { unspecified: 'Tidak ingin menyebutkan', female: 'Perempuan', male: 'Laki-laki' },
    sexHint: 'Dipakai untuk rentang asam urat.',
    doctor: 'Dokter',
    doctorPlaceholder: 'Nama dan klinik',
    conditions: 'Kondisi yang sudah didiagnosis',
    hypertension: 'Hipertensi (tekanan darah tinggi)',
    diabetes: 'Diabetes',
    diabetesHint: 'Gula darah dibandingkan dengan target pengobatan, bukan rentang diagnosis.',
    gout: 'Gout (asam urat)',
    goutHint: 'Asam urat dibandingkan dengan target pengobatan di bawah 6 mg/dL.',
    medications: 'Obat dan dosis',
    medicationsPlaceholder: 'Misalnya: amlodipin 5 mg pagi hari',
    targets: 'Target dari dokter Anda',
    targetsIntro: 'Opsional. Kosongkan untuk memakai rentang umum. Target gula darah dan asam urat dalam mg/dL.',
    tSys: 'Tekanan darah: sistolik di bawah',
    tDia: 'Tekanan darah: diastolik di bawah',
    tFastMin: 'Gula darah puasa mulai',
    tFastMax: 'Gula darah puasa hingga',
    tAfter: 'Gula darah setelah makan di bawah',
    tUric: 'Asam urat di bawah',
    targetsHint: 'Target gula darah berlaku jika Diabetes dicentang.',
    discard: 'Buang perubahan',
    saveProfile: 'Simpan profil',
    profileSaved: 'Profil disimpan',
    language: 'Bahasa',
    languageHint: 'Mengubah seluruh aplikasi, termasuk wawasan dan laporan PDF.',
    glucoseUnit: 'Satuan gula darah',
    glucoseUnitHint: 'mg/dL dipakai di Indonesia dan Amerika Serikat; mmol/L di Inggris, Eropa, dan Australia.',
    uricUnit: 'Satuan asam urat',
    appearance: 'Tampilan',
    themes: { system: 'Sistem', light: 'Terang', dark: 'Gelap' },
    install: 'Pasang Vitalis',
    installBody: 'Tambahkan ke layar utama. Terbuka layar penuh dan berfungsi tanpa internet.',
    installButton: 'Pasang aplikasi',
    data: 'Data Anda',
    dataSummary: (c: number) => `${n(c, 'pengukuran')}, hanya tersimpan di browser ini.`,
    mayClear: 'Browser dapat menghapusnya jika penyimpanan hampir penuh, jadi simpan cadangan.',
    backup: 'Cadangkan data',
    restore: 'Pulihkan cadangan',
    protect: 'Lindungi penyimpanan',
    protected: 'Penyimpanan kini terlindungi',
    protectDenied: 'Browser tidak mengizinkannya. Memasang aplikasi biasanya membantu.',
    addSample: 'Tambah contoh pengukuran',
    sampleAdded: 'Contoh pengukuran 60 hari ditambahkan',
    deleteAll: 'Hapus semua pengukuran',
    deleteConfirm: (c: number) => `Hapus semua ${c} pengukuran dari perangkat ini? Tindakan ini tidak dapat dibatalkan. Buat cadangan dulu jika mungkin masih diperlukan.`,
    deleted: 'Semua pengukuran dihapus',
    backupSaved: 'Cadangan disimpan',
    restoreProfile: 'Pulihkan juga profil dari cadangan?',
    restored: (c: number, skipped: number) => `${n(c, 'pengukuran')} dipulihkan${skipped ? `, ${skipped} dilewati karena tidak dapat dibaca` : ''}`,
    about: 'Tentang',
    aboutBody:
      'Vitalis adalah catatan pribadi, bukan alat medis. Vitalis tidak mendiagnosis, mengobati, atau menggantikan nasihat dokter, dan tidak dapat mendeteksi keadaan darurat. Rentang mengikuti kategori tekanan darah ACC/AHA, standar gula darah ADA, rentang laboratorium umum untuk asam urat, dan target gout ACR.',
    version: (v: string) => `Versi ${v}`
  },

  welcome: {
    headline: 'Tanda vital Anda, dalam satu halaman yang jelas.',
    body: 'Catat tekanan darah, denyut jantung, gula darah, dan asam urat hanya dengan beberapa ketukan. Lihat posisi setiap hasil, perubahannya dari minggu ke minggu, dan hal yang perlu dibicarakan dengan dokter. Pengukuran Anda tetap di perangkat ini.',
    quick: 'Dua pertanyaan singkat',
    sex: 'Jenis kelamin (dipakai untuk rentang asam urat)',
    diagnosed: 'Apakah dokter pernah mendiagnosis salah satu kondisi ini?',
    diagnosedHint: 'Pilihan ini mengubah gula darah dan asam urat ke target pengobatan. Anda dapat mengubahnya nanti di Pengaturan.',
    ack: 'Saya memahami bahwa Vitalis adalah catatan pribadi, bukan nasihat medis. Vitalis tidak mendiagnosis penyakit atau mendeteksi keadaan darurat, dan saya akan membicarakan hasil pengukuran saya dengan dokter.',
    start: 'Mulai mencatat',
    sample: 'Coba dengan contoh pengukuran'
  },

  log: {
    title: 'Catat pengukuran',
    editTitle: 'Ubah pengukuran',
    measurement: 'Pengukuran',
    systolic: 'Sistolik (atas)',
    diastolic: 'Diastolik (bawah)',
    pulse: 'Nadi (opsional)',
    unit: 'Satuan',
    position: 'Posisi',
    hr: 'Denyut jantung (bpm)',
    when: 'Waktu',
    glucose: (u: string) => `Gula darah (${u})`,
    fastingHint: 'Puasa berarti tidak makan atau minum apa pun selain air putih selama minimal 8 jam.',
    uric: (u: string) => `Asam urat (${u})`,
    rulerSystolic: 'Sistolik',
    rulerDiastolic: 'Diastolik',
    dateTime: 'Tanggal dan waktu',
    tags: 'Tag',
    notes: 'Catatan',
    notesPlaceholder: 'Kondisi Anda, makanan, gejala, obat yang diminum...',
    delete: 'Hapus',
    save: 'Simpan pengukuran',
    saveChanges: 'Simpan perubahan',
    saved: 'Pengukuran disimpan',
    savedUrgent: 'Pengukuran disimpan. Lihat saran di halaman Hari ini.',
    updated: 'Pengukuran diperbarui',
    deleted: 'Pengukuran dihapus',
    errBoth: 'Masukkan kedua angka dari alat ukur Anda.',
    errValue: 'Masukkan hasil pengukuran.',
    errSys: (lo: number, hi: number) => `Sistolik (angka atas) seharusnya antara ${lo} dan ${hi} mmHg.`,
    errDia: (lo: number, hi: number) => `Diastolik (angka bawah) seharusnya antara ${lo} dan ${hi} mmHg.`,
    errOrder: 'Angka atas (sistolik) biasanya lebih tinggi daripada angka bawah (diastolik). Periksa urutannya.',
    errPulse: (lo: number, hi: number) => `Nadi seharusnya antara ${lo} dan ${hi} bpm.`,
    errHr: (lo: number, hi: number) => `Denyut jantung seharusnya antara ${lo} dan ${hi} bpm.`,
    errGlucoseMmol: 'Gula darah seharusnya antara 0,6 dan 44 mmol/L. Periksa satuannya.',
    errGlucoseMg: 'Gula darah seharusnya antara 10 dan 800 mg/dL. Periksa satuannya.',
    errUricUmol: 'Asam urat seharusnya antara 30 dan 1190 µmol/L. Periksa satuannya.',
    errUricMg: 'Asam urat seharusnya antara 0,5 dan 20 mg/dL. Periksa satuannya.',
    errDate: 'Pilih tanggal dan waktu.',
    errFuture: 'Tanggal dan waktu berada di masa depan.'
  },

  backup: {
    notJson: 'Berkas ini bukan cadangan Vitalis: bukan JSON yang valid.',
    notBackup: 'Berkas ini bukan cadangan Vitalis. Pilih berkas yang diekspor dari Pengaturan > Cadangkan data.',
    csvHeader: ['Tanggal', 'Waktu', 'Pengukuran', 'Nilai', 'Satuan', 'Nadi (bpm)', 'Keterangan', 'Tag', 'Catatan']
  },

  pdf: {
    title: 'Laporan hasil pengukuran kesehatan',
    subject: 'Tekanan darah, denyut jantung, gula darah, dan asam urat',
    readingsFrom: (from: string, to: string, gen: string) => `Pengukuran dari ${from} sampai ${to}. Dibuat ${gen}.`,
    name: 'Nama',
    age: 'Usia',
    ageValue: (age: number, year: number) => `${age} tahun (lahir ${year})`,
    sex: 'Jenis kelamin',
    sexValue: { unspecified: 'Tidak disebutkan', female: 'Perempuan', male: 'Laki-laki' },
    conditions: 'Kondisi yang diketahui',
    conditionNames: { hypertension: 'Hipertensi', diabetes: 'Diabetes', gout: 'Gout' },
    medications: 'Obat',
    doctor: 'Dokter',
    notGiven: 'Tidak disebutkan',
    noneRecorded: 'Belum dicatat',
    targets: (list: string) => `Target pribadi dari dokter: ${list}.`,
    tBp: (s: string, d: string) => `Tekanan darah di bawah ${s}/${d} mmHg`,
    tFasting: (lo: number, hi: number) => `Gula darah puasa ${lo}-${hi} mg/dL`,
    tAfter: (v: number) => `Gula darah setelah makan di bawah ${v} mg/dL`,
    tUric: (v: number) => `Asam urat di bawah ${v} mg/dL`,
    summary: 'Ringkasan',
    readingsCount: (c: number) => n(c, 'pengukuran'),
    none: 'Tidak ada pengukuran dalam periode ini.',
    cols: ['Pengukuran', 'Jumlah', 'Rata-rata', 'Min-maks', 'Dlm rentang', 'Tren/bulan', 'Terakhir'],
    tooFew: 'Terlalu sedikit',
    summaryNote: 'Tren tekanan darah adalah sistolik. Denyut jantung termasuk nadi yang tercatat bersama pengukuran tekanan darah.',
    trends: 'Tren',
    trendsNote: 'Titik adalah pengukuran, diberi warna sesuai kategori; garis adalah rata-rata 7 hari',
    bpChartNote: (s: number, d: number) => `Garis atas sistolik, garis bawah diastolik. Putus-putus: ${s}/${d} mmHg`,
    noReadingsChart: 'Tidak ada pengukuran dalam periode ini',
    findings: 'Temuan',
    questions: 'Pertanyaan untuk dibicarakan',
    questionsNote: 'Ruang untuk jawaban',
    tests: 'Tes yang bisa ditanyakan',
    testsNote: 'Tebal = muncul karena pengukuran ini',
    whoToSee: 'Dokter yang perlu ditemui',
    suggested: ' (disarankan)',
    urgent: 'Segera ke fasilitas kesehatan jika:',
    allReadings: 'Semua pengukuran',
    allReadingsNote: (c: number) => `${c} dalam periode ini, yang terlama di atas`,
    logCols: ['Tanggal', 'Waktu', 'Pengukuran', 'Nilai', 'Satuan', 'Kategori', 'Keterangan, tag, dan catatan'],
    footer: 'Dicatat sendiri oleh pasien di rumah dengan Vitalis. Dibandingkan dengan rentang acuan dewasa umum; bukan diagnosis.',
    page: (p: number, total: number) => `Halaman ${p} dari ${total}`,
    fileName: 'Vitalis-laporan',
    shareTitle: 'Laporan hasil pengukuran kesehatan'
  }
};
