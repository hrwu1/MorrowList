# CI and branch protection

`ci.yml` runs on every pull request and on pushes to `main`.

## Required checks

Configure branch protection on `main` to require all four jobs:

- **Lint, types, and contracts** — formatting, ESLint including the dependency-boundary
  negative test, TypeScript, and the OpenAPI drift check.
- **Unit tests** — every package's Vitest suite.
- **Integration tests** — migrations applied from an empty PostgreSQL 18 database, then
  the database-backed suites.
- **Browser end-to-end** — Playwright against a real server and database.

Also enable: require a pull request before merging, dismiss stale approvals on new
commits, and require branches to be up to date before merging.

## Why the split

The static job needs no database, so a formatting slip fails in about a minute instead of
waiting behind a container. The database jobs are separated from each other so an
integration failure and an end-to-end failure are distinguishable at a glance.

## What the other workflows do

`Publish image` builds the self-hosting image on native AMD64 and ARM64 runners.
Each platform is smoke-tested against PostgreSQL before the shared image tags move.
Pull requests only build; pushes to `main` publish `edge`, and version tags publish releases.
It is separate from the four CI checks above.

BuildKit provenance (`mode=max`) and SBOMs are always attached to the platform images.
GitHub-signed attestations additionally run for public repositories. Private repositories
require GitHub Enterprise Cloud; eligible owners can set the repository variable
`GITHUB_ATTESTATIONS_ENABLED=true`. A user-owned private repository cannot use that
API, so it publishes with BuildKit metadata but without GitHub-signed attestations.
This preserves repository privacy and does not suppress build or smoke-test failures.
See the [official action's availability policy](https://github.com/actions/attest-build-provenance#readme).

`Benchmark` runs nightly or manually. It samples latency after warm-up, enforces the
spec's single-task read/mutation budgets, and compares p95 to its previous runner result.
Maximum-size 200-task batches use that regression comparison rather than treating 200
sequential operations as one common mutation with a 500 ms deadline.

## Keeping local checks representative

Before pushing, run `pnpm format:check`, `pnpm build`, `pnpm lint`, `pnpm typecheck`,
`pnpm openapi:check`, `pnpm test`, and `pnpm test:integration`. Give integration and
browser tests distinct disposable databases; both suites truncate their target tables.
Run `CI=1 pnpm test:e2e` after building to exercise the production server used by CI.

Browser specs import `test` from `e2e/fixtures.ts`. Each test attempt gets an independent
forwarded client address so unrelated sign-ups do not exhaust one production IP quota.
Rate limiting remains enabled and has its own browser regression test. Keep task-key and
activity assertions aligned with the documented display format when changing that format.

Local passing checks do not update GitHub: the repair must be pushed and the resulting
workflows verified before claiming remote CI or image publication succeeded.
