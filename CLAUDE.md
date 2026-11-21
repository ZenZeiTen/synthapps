# Working rules for this repository

## GitHub Actions: as little as possible, never macOS, Linux only when essential

The owner pays for Actions minutes. This rule is permanent and overrides any
habit, template or skill that suggests otherwise.

- **Never use macOS runners** (`macos-*`), in any job or `matrix`.
- **No Linux test, lint or build jobs.** Lint, tests (unit, browser, WordPress
  smoke tests) and builds that work on Linux run in the Claude Code container
  before pushing. Report the results in the PR description instead of relying
  on a workflow run.
- **No Linux or macOS builds of the apps** (AppImage, deb, dmg, Linux or macOS
  executables) made on Linux or macOS runners. Go binaries that the Windows
  runner already cross-compiles for Linux and macOS (Kempt, Keyhold) may stay.
- **A Linux runner (`ubuntu-latest`) only when essential**, and only at release
  time: publishing a GitHub release, the version check that decides whether to
  release, and release packaging that cannot be done elsewhere (WordPress plugin
  zips, Android APKs, web-app zips). Gate such jobs on the release tag or the
  Run workflow button, never on every push or pull request, and keep packaging
  and publishing in one job where possible (each job is billed in whole minutes).
- **Windows runners (`windows-latest`) only for what needs Windows**: Windows
  builds, Windows-only tests and smoke tests. One OS, one language version, no
  matrix. A `pull_request` trigger with tight `paths:` filters is fine for real
  Windows tests; pure packaging builds run only on release or by hand. Do not
  add `push` to `main` triggers that repeat what the pull request already ran.
- **Do not create a new workflow** unless the user asks for one or the work is
  impossible without it. If unsure, ask first.
- **Code scanning (CodeQL default setup)** is a repository setting that runs on
  Linux runners for every push and PR. Only the owner can change it (Settings →
  Code security → Code scanning). Every push to a PR branch starts it again, so
  batch changes into fewer pushes.

The workflows in `.github/workflows/` were converted to this rule in November
2026. Keep them that way when editing them.
