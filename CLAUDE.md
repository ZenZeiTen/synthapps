# Working rules for this repository

## GitHub Actions: use as little as possible, and never on Linux or macOS

The owner pays for Actions minutes. This rule is permanent and overrides any
habit, template or skill that suggests otherwise.

- **Never use Linux or macOS runners.** Do not add or keep `runs-on:` values
  such as `ubuntu-*` or `macos-*`, including inside a `matrix`. This applies to
  every job, including short ones like `release` or `lint`.
- **Run Linux checks here, not in CI.** Lint, tests and builds that work on
  Linux run in the Claude Code container before pushing. Report the results in
  the PR description instead of relying on a workflow run.
- **Use Actions only when necessary.** The accepted case is work that cannot
  run in the container, such as a Windows build or a Windows-only test. Then:
  - use `windows-latest` only;
  - prefer `workflow_dispatch` or tag triggers over `push` / `pull_request`;
  - keep tight `paths:` filters and no OS matrix;
  - do release steps (for example `gh release create`) in the same Windows job
    instead of adding a separate Linux job.
- **Do not create a new workflow** unless the user asks for one or the work is
  impossible without it. If unsure, ask first.
- **Existing workflows** in `.github/workflows/` predate this rule and still
  contain Linux and macOS jobs. Do not extend them. When editing one, remove or
  convert its Linux and macOS jobs as part of the change, or ask the user first
  if that would change what gets built or released.
