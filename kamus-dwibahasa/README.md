# Kamus Dwibahasa

A bilingual Indonesian–English dictionary web app (Next.js App Router,
TypeScript, Tailwind CSS). See [APP.md](APP.md) for features and details.

This app used to share the `reimagined-couscous` repository with two other
projects. They now live next to it in synthapps:

- [`raycaster/`](../raycaster/) — a 3.5D raycasting game engine, with its Claude skill in `raycaster/skill/`
- [`lang-forge/`](../lang-forge/) — a Claude skill for designing new programming languages

## Dictionary app

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint       # ESLint (next/core-web-vitals + next/typescript)
npm run typecheck  # tsc --noEmit
npm run build
```
