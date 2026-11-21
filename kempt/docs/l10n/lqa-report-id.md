# LQA report: Kempt EN→ID (id-ID)

Independent review of all 434 Indonesian strings against `en.json`, with the locked termbase
(`termbase-id.md`), the Indonesian UI style rules and MQM. The reviewer did not translate.

| | |
|---|---|
| Source words | 2,960 |
| Findings | 0 Critical, 0 Major, 13 Minor, 4 Neutral notes |
| MQM score | 1 − 13 ÷ 2,960 = **0.9956** (0.44 penalty points per 100 words) |
| Verdict | Fit for release after the Minor fixes, all applied |

## Minor findings (all fixed)

| # | Key | Was | Now | MQM |
|---|---|---|---|---|
| 1 | files.folder | Folder yang dicari | Cari di folder | Accuracy |
| 2 | why.drivers.title | …dari database sendiri | …dari database miliknya sendiri | Accuracy |
| 3–5 | priv.silent-installs.what, startup.lede, privacy.lede | tombol (button) | sakelar (MTC: switch = sakelar) | Terminology |
| 6 | health.disk.detail | {{media}} {{size}}, status: … | {{size}}, {{media}}, status: … (no lower-case sentence start) | Fluency/Design |
| 7 | date.today | Hari ini {{time}} | Hari ini pukul {{time}} (matches date.at) | Style |
| 8 | health.repair.advice | Prosesnya 10 sampai 30 menit | Proses ini memakan waktu 10 sampai 30 menit | Fluency |
| 9 | health.repair.detail | …terhadap salinan yang diketahui baik | …dengan salinan yang dipastikan utuh | Fluency |
| 10 | health.disk.unhealthy | Drive melaporkan bahwa drive sedang rusak | Drive melaporkan bahwa dirinya mulai rusak | Fluency |
| 11 | settings.minimized.needsStartup | Aktifkan Jalankan saat Windows dimulai… | Aktifkan “Jalankan saat Windows dimulai”… | Fluency |
| 12 | dupes.keepOne | Simpan setidaknya… | Sisakan setidaknya… (“Simpan” is the Save button) | Fluency |
| 13 | why.score.title | Memberi skor untuk PC Anda atau “mode AI” | Memberi PC Anda skor atau “mode AI” | Fluency |

## Neutral notes (not counted)

- `err.schedule.time`: the time field needs HH:MM with a colon; times shown to people use the
  Indonesian dot (21.05). Correct as is.
- `nav.why`: “Yang tidak akan dilakukan Kempt” would carry the refusal of “won't” more strongly; the
  shorter form is kept for the sidebar.
- `health.storagesense.advice`: slightly nominal, correct.
- `health.uptime.advice`: quotes the power-menu label as “Hidupkan ulang” (MTC). Check on an
  Indonesian Windows 11 build, which may show “Mulai ulang”.

## Other QA in this job

- Format QA (app-loc-forge `l10n_check.py`, with the job glossary): 0 errors; 11 warnings reviewed
  (two intentional identical strings, nine full sentences longer than 1.6× the English that wrap).
- On-screen QA: Chromium end-to-end test in Indonesian on every page, at 1280 px and phone width,
  with checks for sideways scrolling and for any raw `{{placeholder}}` or untranslated key. It found
  one Critical defect, fixed before this review: a History line showed “Cache {{browser}}” because
  a stored argument with its own placeholder was filled in map order.
