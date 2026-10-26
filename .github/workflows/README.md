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
workflows verified before claiming remote CI succeeded.

Benchmark regression baselines are partitioned by CPU model/core count, OS/architecture,
exact Node version, selected dataset scale, and the benchmark/workflow source hash.
A different environment starts a new baseline while retaining all absolute budgets;
unchanged code is no longer compared across unrelated GitHub runner CPUs.

The reference performance job uses `ubuntu-24.04-arm`. Its report records the actual
CPU and core count. The x86 CI integration budgets remain enabled; the 100,000-task HTTP
benchmark, concurrency four, 300 ms read budget and 20% comparable-run regression
threshold are unchanged.
