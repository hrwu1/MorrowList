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
