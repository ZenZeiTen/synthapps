# contextchat: notes for Claude

A WordPress plugin: a chat button for WhatsApp that pre-fills the message with page context.
`README.md` is for users and developers; this file is for whoever changes the code. The
repository-wide guide for WordPress plugins is `.claude/skills/wordpress-plugin/SKILL.md`.

## Check every change

From `contextchat/`:

```bash
npm test           # PHP and JavaScript unit tests
npm run test:e2e   # browser tests against a throwaway WordPress site (needs php, curl, unzip)
npm run build      # writes dist/contextchat-<version>.zip and prints its path
npm run i18n       # after changing strings: refreshes the .pot, merges each .po, rebuilds .mo/.json
```

`npm test` includes a dry run of the golden conversations (`tests/golden/`), which needs no network.
The live run, `npm run eval`, plays them against the real API and has Claude Haiku grade the tone.
It needs `ANTHROPIC_API_KEY` and costs money (stops at `--max-cost`, default $2), so run it only
when the user asks, and never in CI. Run it after changing the prompt, voice, knowledge or models.

CI: `.github/workflows/contextchat.yml` (a build on Windows, whose zip the release publishes; release
from the Run workflow button with "Publish a release" ticked on `main`). It runs no lint or tests:
run them here before pushing (see the root CLAUDE.md).

## Giving the user the plugin

The owner installs the plugin by uploading a zip in WordPress, often from Windows. Whenever a
task produces a new or changed plugin, end it with something they can install:

- **Built a zip:** run `npm run build`, then send `dist/contextchat-<version>.zip` to the user
  as a file in the chat. Do not commit it: `dist/` is ignored, and nothing built belongs in git.
- **Published a release:** give the direct download link, after checking the release exists:
  `https://github.com/ZenZeiTen/synthapps/releases/download/contextchat-v<version>/contextchat-<version>.zip`
- **Not released yet:** say so plainly, send the zip if you have built one, and offer to start
  the release run. Publishing is public, so start it only when the user asks for this release.

Give Windows commands for PowerShell, from the `contextchat` folder of their copy. `npm run build`
is plain Node (`scripts/build-zip.mjs`), so it needs no bash, `zip` or WSL.

## Rules

- `assets/js/contextchat.js` repeats the template rules of `includes/class-template.php`. Change
  both together; `tests/fixtures/templates.json` is run against each.
- Bump the version in all of: `contextchat.php` (header and `CONTEXTCHAT_VERSION`),
  `readme.txt` (`Stable tag` and changelog), `package.json`, `package-lock.json`,
  `RELEASE_NOTES.md`, and the zip name in `README.md`. Then run `npm run i18n`.
- Analytics store times in UTC and report days in the site time zone
  (`ContextChat_Analytics::daily_counts()`).
