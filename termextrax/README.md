# TermExtrax

A local web application for translators and localizers: align source and target
texts sentence-by-sentence, fix the alignment interactively, extract terminology
from the source text, map target equivalents, and export the results as a
translation memory (TMX/CSV) and a termbase (TBX/CSV).

## Features

- **Ingestion** — upload `.txt` files (encoding auto-detected: UTF-8, UTF-16,
  CP1252, Latin-1) or Microsoft Office documents — Word (`.docx`), Excel
  (`.xlsx`), PowerPoint (`.pptx`) — or paste text directly; language dropdowns
  for both sides. Office text extraction preserves paragraph, table-row and
  slide structure so segmentation respects the document layout.
- **Segmentation** — sentence splitting with spaCy (full pretrained model when
  installed, rule-based sentencizer fallback for any language).
- **Automatic alignment** — Gale–Church length-based alignment (supports 1-1,
  1-0, 0-1, 2-1, 1-2, 2-2 beads) or a sequential 1:1 baseline.
- **Interactive alignment editor** — side-by-side table with per-cell
  **merge**, **split at cursor**, **shift up/down** (column-wise, so one shift
  fixes a whole misalignment cascade), inline **edit**, row insert/delete,
  approval status, and highlighting of empty cells.
- **Term extraction** — noun chunks (when a spaCy model with a parser is
  available) combined with stopword-filtered unigram/bigram frequency
  analysis; results sorted by frequency.
- **Terminology panel** — filterable sidebar listing extracted terms with an
  input to map each target equivalent; manual add/remove.
- **Export** — aligned corpus as CSV or TMX 1.4; termbase as CSV or TBX
  (TBX-Basic style), optionally including unmapped terms.

## Project layout

```
backend/            FastAPI + spaCy API
  app/main.py       routes: /api/upload, /api/segment, /api/extract-terms, /api/export/*
  app/nlp.py        pipeline loading, segmentation, term extraction
  app/alignment.py  Gale–Church + sequential alignment
  app/office.py     .docx / .xlsx / .pptx text extraction (stdlib only)
  app/exports.py    TMX / TBX / CSV generation
  launcher.py       single-process entry point for the packaged executable
  TermExtrax.spec   PyInstaller spec
frontend/           React (TypeScript) + Vite + Tailwind CSS + Zustand
  src/store.ts      alignment/termbase state and row operations
  src/components/   IngestPanel, AlignmentTable, TermPanel, ExportPanel
build_exe.bat       one-command Windows executable build
build_exe.sh        same for Linux/macOS
```

## Standalone executable (easiest way to run)

Build a single self-contained executable — no Python or Node needed on the
machine that runs it:

```bat
:: Windows (requires Python 3.10+ and Node.js 18+ on the BUILD machine)
build_exe.bat
```

```bash
# Linux / macOS
./build_exe.sh
```

The result is `backend/dist/TermExtrax.exe` (Windows) or
`backend/dist/TermExtrax` (Linux/macOS). Double-click it (or run it from a
terminal): it starts the server on a free local port and opens the app in
your default browser. Close the console window to stop it. Set
`TERMEXTRAX_NO_BROWSER=1` to suppress the automatic browser launch.

Note: PyInstaller does not cross-compile — build the `.exe` on Windows, the
Linux binary on Linux. The executable bundles whichever spaCy models are
installed in the Python environment at build time, so optionally run
`python -m spacy download en_core_web_sm` (etc.) before building.

### Pre-built .exe from GitHub Actions

The `Build Windows executable` workflow
(`.github/workflows/build-windows-exe.yml`) builds `TermExtrax.exe` on a
Windows runner with the English spaCy model bundled, smoke-tests it, and:

- on every **published release** — attaches `TermExtrax-windows-x64.exe`
  as a release asset;
- on **manual dispatch** (Actions tab → Build Windows executable →
  Run workflow) — uploads it as a downloadable workflow artifact.

## Running from source

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Optional but recommended — full models improve sentence splitting and enable
# noun-chunk term extraction (any language you need):
python -m spacy download en_core_web_sm

uvicorn app.main:app --reload --port 8000
```

Languages without an installed model automatically use a rule-based
sentencizer and frequency-based term extraction, so every language in the
dropdown works out of the box.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — the Vite dev server proxies `/api` to the
backend on port 8000.

## Workflow

1. Paste or upload the source and target texts (`.txt`, `.docx`, `.xlsx` or
   `.pptx`), pick their languages, choose the alignment method, and click
   **Segment, align & extract terms**.
2. Fix the alignment in the table: double-click to edit, hover a cell for
   **Merge ↓** / **Split at cursor** / **Shift ↑** / **Shift ↓**. Empty cells
   are highlighted amber; click the status pill to approve a row.
3. Map target equivalents for the extracted terms in the sidebar.
4. Export: corpus → CSV/TMX, termbase → CSV/TBX.
