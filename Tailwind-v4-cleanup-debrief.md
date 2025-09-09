# Tailwind v4 cleanup – debrief

Date: 2025-09-08
Author: Automation (script: `scripts/tw-v4-clean.sh`)

## What the script did

- Removed legacy PostCSS config files (postcss.config.* / .postcssrc*).
- Uninstalled PostCSS-side packages: `@tailwindcss/postcss`, `autoprefixer`, `postcss-nesting`, `postcss`.
- Kept Tailwind flowing exclusively through the Vite plugin (`@tailwindcss/vite`).
- Standardized Node engines to `>=20.3.0 <21 || >=22`.
- Optionally adds `@plugin "@tailwindcss/typography";` next to `@import "tailwindcss";` if `class="prose"` is found (not detected in this run).
- Reinstalled dependencies for a clean lockfile.

## Why this helps

- Avoids “double-processing” Tailwind (Vite + PostCSS) which can cause CSS drift and duplicated utilities.
- Reduces moving parts and build time (Vite is the single orchestrator, Lightning CSS handles prefixing/nesting).
- Aligns engines to modern Node, preventing install/build warnings in CI and dev.

## Before vs after – issues removed

Prior risk/anti-patterns addressed by the cleanup:

- Legacy PostCSS pipeline present (`postcss.config.cjs`) alongside the Vite plugin. This can lead to duplicate Tailwind transformations or unexpected CSS differences.
  - After: PostCSS config removed; only Vite plugin remains.
- Repo contained references to PostCSS-only tools (`@tailwindcss/postcss`, `autoprefixer`, `postcss-nesting`). These were installed and could be picked up unintentionally by tools.
  - After: Packages uninstalled; remaining mentions are in docs/guard scripts only (see Scoreboard).
- Engines not guaranteed to allow Node 22.
  - After: engines.node set to `>=20.3.0 <21 || >=22`.

Note: Several build failures we fixed in parallel (undefined imports in `.astro` files) were unrelated to Tailwind, but running the cleanup eliminated any CSS-pipeline culprits from the equation and made builds more deterministic.

## Scoreboard snapshot (repo-only)

- Vite plugin present: 1
- PostCSS config files: 0
- Uses `@tailwindcss/postcss`: 8 (doc/scripts references only)
- Uses `autoprefixer`: 4 (doc/scripts references only)
- Uses `postcss-nesting`: 4 (doc/scripts references only)
- New `@import "tailwindcss"`: 1
- Old `@tailwind base|components|utilities;`: 3

Interpretation:
- The pipeline is clean (no postcss.config; Vite plugin detected).
- Non-zero counts for PostCSS terms are text references (e.g., `scripts/guard-postcss.mjs`, docs). They don’t affect the build but can be confusing.
- There are still 3 legacy `@tailwind ...;` directives somewhere in `src/`; consider migrating them to Tailwind v4 style with a single `@import "tailwindcss";` and optional layer plugins.

## Follow-ups to consider

1) Remove or repurpose PostCSS guard scripts
- `scripts/guard-postcss.mjs` and any npm scripts referencing it (`guard:postcss`) can be pruned or rewritten to assert the Vite-only path instead of enforcing PostCSS.

2) Migrate any remaining legacy Tailwind directives
- Replace `@tailwind base; @tailwind components; @tailwind utilities;` with a single `@import "tailwindcss";` in global CSS.
- If typography is desired and `prose` classes appear later, add `@plugin "@tailwindcss/typography";` below that import.

3) Confirm stylelint configuration
- If Stylelint rules assume PostCSS processing, ensure they’re compatible with v4/Vite. Current Stylelint runs are optional and shouldn’t block, but keeping rules up-to-date avoids confusion.

4) Keep an eye on Netlify dev environment
- We observed intermittent local Netlify Edge Functions connection errors during `npm run dev`. Not Tailwind-related, but worth verifying `@astrojs/netlify` local emulation requirements (Deno availability, network) to keep DX smooth.

5) Optional: add a convenience npm script
- Add `"tw:clean": "bash scripts/tw-v4-clean.sh"` to package.json for one-command re-runs.

## Acceptance criteria met

- PostCSS configs removed.
- PostCSS-side deps uninstalled.
- Tailwind v4 runs via Vite plugin only.
- engines.node updated.
- Clean install performed; build runs deterministically with a single CSS pipeline.

## How to rerun

- `bash scripts/tw-v4-clean.sh`

This script is idempotent; it’s safe to run again after future merges.
