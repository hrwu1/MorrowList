# Architecture fixtures

`scripts/check-boundaries.mjs` generates positive and negative cases from the allowed
dependency matrix in `packages/config/eslint/boundaries.js`. Explicit cases also cover
relative paths, aliases, dynamic imports, re-exports, public subpaths, and the narrow
composition-root and test-harness exceptions.

The checker uses ESLint virtual files. It never writes temporary files into a compiler
source tree, so it can run alongside TypeScript without fixture creation/removal races.
Run `pnpm lint:boundaries`; normal `pnpm lint` includes the same check.
