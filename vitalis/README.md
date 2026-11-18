# Vitalis

A private health tracker for **blood pressure, heart rate, blood glucose and uric acid**. Log a reading in a few taps, see where it falls and how it changes over weeks, get plain-language insights with questions for your doctor, and take a PDF report to your appointment.

It runs as an installable web app (PWA) that works offline, and as an Android app built with Capacitor. Readings never leave the device unless you export them.

> Vitalis is a personal record, not a medical device. It compares readings with published adult reference ranges; it does not diagnose, treat or detect emergencies.

## What it does

| Area | Details |
|---|---|
| **Logging** | Blood pressure (systolic, diastolic, optional pulse, position, arm), heart rate (resting, after waking, during or after exercise), glucose (fasting, before a meal, 1–2 h after a meal, bedtime, any time) and uric acid. Date and time, unit (mg/dL or mmol/L for glucose; mg/dL or µmol/L for uric acid), tags such as *Took medication* or *Irregular heartbeat*, and free-text notes. The form grades the reading as you type. |
| **Today** | Latest reading for each measurement in large numerals, a range ruler showing where it falls between the categories, a 30-day sparkline, and an alert when a recent reading is in the urgent range. |
| **Trends** | Interactive chart per measurement over 7 days to all time: every reading as a dot coloured by category, a 7-day moving average, reference bands or threshold lines, touch and keyboard tooltips. Averages, range, share in range, trend per month, how readings fall across categories, and averages by time of day. |
| **Journal** | Every reading grouped by day, filter by measurement, search notes and tags, edit or delete with undo. |
| **Insights** | Findings for the chosen period (averages graded, rising or falling trends, morning versus evening blood pressure, differences between arms, variability, wide pulse pressure, lows and very high glucose, an estimated HbA1c, uric acid against the gout target). Questions for your doctor that follow from the readings, plus your own. Tests worth asking about, which doctor to see, and when to get urgent care. |
| **Report** | An A4 PDF with patient details, a summary table, vector charts, findings, the chosen questions with space for answers, tests and doctors, and a table of every reading. Download, share (phones and Android) or export CSV. |
| **Languages** | English and Bahasa Indonesia, switched with the EN / ID toggle in the header (also on the welcome screen, in Settings and next to the report options). Everything follows the choice: screens, grading text, insights, questions, the PDF report and CSV headers. Indonesian uses Indonesian dates and a decimal comma (6,4 mg/dL). On first launch the app picks Indonesian if the device is set to it. The install name, description and home-screen shortcut follow the language too ("Vitalis Health Tracker" or "Vitalis Pencatat Kesehatan"). |
| **Settings** | Profile (age, sex, diagnosed conditions, medications, doctor), personal targets set by a clinician, units, light or dark theme, JSON backup and restore, sample data, delete all. |

## Medical basis

The thresholds live in [`src/lib/ranges.ts`](src/lib/ranges.ts) and are covered by tests in [`tests/ranges.test.ts`](tests/ranges.test.ts).

- **Blood pressure**: ACC/AHA categories (2017, kept in the 2025 AHA/ACC guideline): normal below 120/80, elevated 120–129/<80, stage 1 130–139 or 80–89, stage 2 140+ or 90+, severe above 180/120. Low is described as below 90/60.
- **Heart rate**: resting adult range 60–100 bpm. Readings during or after exercise are not graded.
- **Glucose**: ADA Standards of Care. Without diabetes: fasting 70–99 normal, 100–125 prediabetes range, 126+ diabetes range; after a meal under 140 usual, 140–199 above usual, 200+ high. With diabetes (ticked in Settings): 80–130 before meals and under 180 after meals, or the clinician's targets. Below 70 is low and below 54 mg/dL is level 2 hypoglycaemia.
- **Uric acid**: typical laboratory ranges of about 2.4–6.0 mg/dL for women and 3.4–7.0 mg/dL for men, the solubility limit near 6.8 mg/dL, and the ACR gout treatment target below 6 mg/dL. 9 mg/dL and above is "well above range".
- **Estimated HbA1c**: the ADAG formula (eAG = 28.7 × A1C − 46.7), shown only with 14+ readings over 14+ days and labelled as a rough estimate.

Laboratories, age, pregnancy and medical history change what is right for a person. A clinician's targets entered in Settings replace the general ones.

## Languages

Text lives in two dictionaries, [`src/i18n/en.ts`](src/i18n/en.ts) and [`src/i18n/id.ts`](src/i18n/id.ts). English is the source; the Indonesian file must have the same shape, so a missing translation fails the type-check, and [`tests/i18n.test.ts`](tests/i18n.test.ts) also checks that no English is left in place and that every string prints in the PDF fonts.

Choices survive a language switch: tags are stored by fixed keys and shown translated, and the questions you untick for the report are remembered by ID. Notes and your own questions stay as you wrote them.

A web app has a single manifest, so the build writes one per language from the same dictionaries (`manifest.webmanifest` and `manifest-id.webmanifest`, see [`vite.config.ts`](vite.config.ts)), and the app points the page at the one for the current language. Browsers read it when they offer to install the app; an app that is already installed keeps the name it was installed with until the browser updates it.

To add a language, copy `id.ts`, translate it, add it to `LANGS` and `MANIFEST` in [`src/i18n/index.ts`](src/i18n/index.ts), and write its manifest in `vite.config.ts`.

## Privacy

- Everything is stored in the browser's IndexedDB (or the Android WebView's) on the device. There is no account, server or analytics.
- The Android app turns off Android's automatic cloud backup so readings are not copied off the device; use **Settings > Back up data** for a backup file you control.
- Files leave the device only when you download or share them.

## Run it

Requires Node.js 22.

```bash
cd vitalis
npm install
npm run dev        # development server at http://localhost:5173
npm test           # unit tests for ranges, statistics, insights, backup and translations
npm run build      # type-check and build the PWA into dist/
npm run preview    # serve the production build
```

### Install as an app (PWA)

Host the contents of `dist/` on any HTTPS server (GitHub Pages, Netlify, a sub-folder of an existing site: the build uses relative paths). Open it in Chrome or Edge and choose **Install app** (also offered in Settings), or on iPhone use **Share > Add to Home Screen**. After the first visit it works offline, and offers to reload when a new version is published.

### Android

The `android/` folder is a Capacitor project. With Java 21 and the Android SDK (platform 36):

```bash
npm run android:apk          # builds the web app, copies it in, and runs gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio after `npm run android:sync`. To publish on Google Play, create a release keystore and build with `./gradlew bundleRelease`.

The GitHub Actions workflow [`.github/workflows/vitalis.yml`](../.github/workflows/vitalis.yml) runs the tests and uploads `vitalis-web.zip` and `Vitalis-debug.apk` as artifacts on every pull request. To publish both on a GitHub release, open **Actions > Vitalis > Run workflow** on `main` and tick **Publish a release**: it releases the version in `package.json` as `vitalis-v<version>`. Pushing a tag with that name does the same. A version is released once; raise the version for the next release.

### Icons

`npm run icons` redraws the PWA icons, the Android launcher icons and the Android splash screens from the vector mark in [`scripts/make-icons.mjs`](scripts/make-icons.mjs). It needs Playwright's Chromium.

## Code map

| Path | Purpose |
|---|---|
| `src/i18n/` | English and Indonesian text, the current language, number formatting |
| `src/lib/ranges.ts` | Reference bands and grading for each measurement |
| `src/lib/stats.ts` | Series, averages, regression trend, moving average, streaks |
| `src/lib/insights.ts` | Findings, questions, lab tests, specialists, emergency signs |
| `src/lib/pdf.ts` | The PDF report, drawn with jsPDF vector graphics |
| `src/lib/db.ts`, `backup.ts`, `save.ts` | IndexedDB storage, JSON and CSV export, saving and sharing files on web and Android |
| `src/components/` | Trend chart, range ruler, sparkline, log sheet |
| `src/screens/` | Today, Trends, Journal, Insights, Report, Settings, Welcome |
| `src/styles/app.css` | Design tokens (light and dark) and all styles |

## Limitations

- Readings are typed in; there is no Bluetooth or Health Connect import yet.
- Data lives on one device. Move it with backup and restore.
- English and Indonesian only. Medical wording in Indonesian follows common clinical usage but has not yet been reviewed by an Indonesian clinician.
