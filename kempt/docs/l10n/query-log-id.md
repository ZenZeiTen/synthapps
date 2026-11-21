# Query log: Kempt EN→ID (id-ID)

Open points from the Indonesian localization. Kept outside the delivered files
(`internal/i18n/locales/id.json`) on purpose.

| # | Key(s) | Question or decision | Status |
|---|---|---|---|
| Q1 | `why.score.title` | The source quotes the “AI mode” of other PC optimizers. The house rule renders AI as SI (Kecerdasan Sintesis) except in product or feature names; this is another product's feature name, so it stays “mode AI”. | Flagged; the independent review agrees with keeping “AI” |
| Q2 | all | The Notion Termbase EN↔ID has no locked or approved entry for these terms (all matches are “proposed”, several from other domains, e.g. drivers → penggerak, App → Permohonan). This job's terms come from the Microsoft Terminology Collection and are in `termbase-id.md`. Should they be added to the Notion Termbase as approved, Windows domain? | Needs owner's OK (writes to Notion) |
| Q3 | `word.trash`, `cat.trash.*` | Linux trash = “tempat sampah”. Not verified against GNOME/KDE Indonesian (GNOME may use “Tong Sampah”). Linux build only. | Not verified |
| Q4 | `cat.error-reports*`, `cat.error-reports.safe` | “laporan kesalahan” and “Pemantau Keandalan” (Reliability Monitor) are inferred: Microsoft's term for the service is “Pelaporan Galat Windows”; no Indonesian source for the Reliability Monitor name was found. | Inferred |
| Q5 | `files.folder.*` | Downloads, Documents, Pictures, Videos, Music → Unduhan, Dokumen, Gambar, Video, Musik: the usual Indonesian Windows folder names, not checked against a primary source in this job. | Inferred |
| Q6 | `health.checked` + `date.today` | “Terakhir diperiksa: Hari ini pukul 00.14” keeps the capital H after the colon because `date.today` also starts lines in History. EYD prefers lower case after a colon for a non-sentence. | Minor, accepted |
| Q7 | `startup.where.folder-*` | The Windows Startup folder is kept as “Startup” (its folder name); Settings › Apps › Startup is “Pengaktifan”. | Decision |
| Q8 | `health.disk.detail` | Drive states come from Windows in English (`Healthy`, `Warning`, …) and are mapped to sehat / peringatan / tidak sehat / tidak diketahui; the technical status in brackets (e.g. “Predictive Failure”) stays in English because Windows reports it that way. | Decision |
| Q9 | messages from Windows tools | Text that Windows, PowerShell or winget print (for example an installer's error) cannot be translated and is shown after Kempt's Indonesian sentence. | By design |
| Q10 | `health.uptime.advice` | The power-menu label is quoted as “Hidupkan ulang” (Microsoft Terminology Collection). Indonesian Windows 11 builds may show “Mulai ulang”; check on a real build. | Not verified on a build |
