# Contributing to MorrowList

## Local setup

Prerequisites: Node.js 24, pnpm (via `corepack enable pnpm`), and PostgreSQL 18.

```bash
pnpm setup:dev                # one-time setup; safe to rerun
pnpm dev                      # http://localhost:3200
```

`pnpm setup:dev` installs workspace dependencies, creates `.env` from `.env.example`
when absent, generates its local `AUTH_SECRET`, verifies PostgreSQL is reachable, builds
workspace packages, and applies pending migrations. It preserves an existing `.env`.

For PostgreSQL either run `docker compose -f infra/compose/docker-compose.yml up -d`, or
install it natively and create three databases: one for development, one for the
integration suite, and one for the browser suite.

```bash
createdb morrowlist && createdb morrowlist_test && createdb morrowlist_e2e
```

Both test suites truncate every table, so each refuses to run unless its own URL is set
and differs from `DATABASE_URL`: `TEST_DATABASE_URL` for `pnpm test:integration`, and
`E2E_DATABASE_URL` for `pnpm test:e2e`. Playwright migrates and truncates that database
in its global setup and starts its server against it, so a browser run never touches
development data.

`.env` lives at the repository root and there is only one. Nothing reads it from there on
its own — `next dev` looks only beside the app it serves, and `vitest` and `playwright`
look for no env file at all — so `loadRootEnv()` from `@morrowlist/config/load-env` is
called from `next.config.ts`, `playwright.config.ts`, and the shared vitest integration
preset. It never overwrites a variable that is already set, so CI's `env:` block and a
real deployment still win, and it does nothing when there is no `.env` on disk. Export
nothing by hand; the documented commands work as written.

Generate `AUTH_SECRET` with `openssl rand -base64 32`. There is no usable default; the
application refuses to start in production without it.

## The commands that matter

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `pnpm build`            | Builds every package and app                      |
| `pnpm test`             | Unit tests, no database required                  |
| `pnpm test:integration` | Database-backed tests against `TEST_DATABASE_URL` |
| `pnpm test:e2e`         | Playwright against a real server and database     |
| `pnpm lint`             | ESLint plus the dependency-boundary negative test |
| `pnpm typecheck`        | TypeScript across the workspace                   |
| `pnpm openapi:generate` | Regenerates `docs/api/openapi.json`               |
| `pnpm db:generate`      | Generates a migration from schema changes         |

`pnpm db:migrate` targets `DATABASE_URL`; add `--test` to migrate `TEST_DATABASE_URL`.

## Architecture rules

These are enforced by `pnpm lint`, not by memory. See [ADR index](../adr/README.md) and
section 16.2 of the specification.

- `domain` imports no framework, database, HTTP, auth provider, or UI — and no other
  workspace package. It is the innermost layer.
- `application` imports `domain` and `contracts` and defines ports. It does not import
  Next.js, Hono, Drizzle, or Better Auth.
- `database`, `auth`, and `transports` implement application ports. They are adapters.
  Concrete HTTP delivery, VAPID signing, and sender configuration live in `transports`.
- `api` validates input, builds an `ActorContext`, and calls exactly one use case. It
  contains no business rules.
- `web` never imports Drizzle schema or repositories. The single exception is
  `apps/web/lib/server.ts`, the composition root, which wires the adapters together.
- `cli` and `mcp` talk to the public API through `api-client`. Neither reaches application
  services, the server API implementation, or PostgreSQL directly.
- Cross-package imports use public entry points. No deep imports into another package's
  internals.

`packages/config/eslint/boundaries.js` owns the allowed dependency matrix. Lint resolves
workspace ownership for public package imports, relative paths, aliases, re-exports,
dynamic imports, and literal `require` calls. `scripts/check-boundaries.mjs` checks both
allowed and forbidden imports with virtual files, including the narrow composition-root
and database-harness exceptions; it does not write fixtures into compiler source trees.

## Patterns for equivalent responsibilities

- Application services authorize, open a UnitOfWork, apply domain policy, persist,
  record material activity/outbox events, and map the result. Reuse the transaction-aware
  creation/transition helpers for imports, recurrence, rules, and ordinary commands.
- Nested `execute` calls on the same UnitOfWork join the current transaction. A shared
  replay wrapper can therefore commit its response with every command write. Independent
  requests remain isolated; a callback must await all of its transaction work.
- `Idempotency-Key` identifies one logical mutation attempt. Identical actor/workspace/
  operation/key requests replay for 24 hours; user-owned device registrations use user
  scope instead of requiring a workspace. Changed request fingerprints return 409.
  Successful responses are encrypted using the application secret before storage, and
  failed requests leave no replay record. Client-generated keys belong to a single send;
  retrying after uncertain delivery must retain that key. Synchronous webhook test
  deliveries are explicitly excluded: they send once per request because an external
  HTTP effect cannot be rolled back with the database.
- Keep database-enforced invariants explicit in ports: a transaction alone does not
  serialize count-then-create operations. Test limits/claims with concurrent PostgreSQL
  callers, not only sequential in-memory doubles.
- Shared task-query wire conversion serves lists, exports, and OpenAPI declarations.
  Treat a resolved empty selection as empty; never drop it and query a broader set.
- Web feature hooks compose canonical resource keys and shared task cache policies.
  Every task projection must support the same read/patch/snapshot/cancel/refresh lifecycle.
  Preserve full command results (including warnings), expected versions, and undo feedback.
- Keep views as projections of canonical task DTOs. Bulk actions can deliberately wait
  for atomic server results; notification read state and capability endpoints have their
  documented exceptions. Similar responsibility, not identical syntax, is the criterion.
- Prefer small internal command/query/delivery helpers behind stable service facades.
  Do not create generic CRUD inheritance or duplicate query registries per page.

## Database changes

1. Edit the Drizzle schema in `packages/database/src/schema/`.
2. Run `pnpm db:generate` to produce SQL under `packages/database/drizzle/`.
3. **Read the generated SQL.** Migrations are reviewed, not trusted.
4. Add a hand-written migration where Drizzle cannot express the intent. Migration
   `0001_rank_collation.sql` is the example: Drizzle does not model column collation, and
   rank columns must be `COLLATE "C"` or manual ordering breaks.
5. Migrations are forward-only and must apply cleanly from an empty database.

## Testing expectations

Match the test to what could actually break.

- **Unit** for domain policies and pure logic. Fast, no I/O.
- **Integration** for anything that depends on SQL: constraints, locking, collation,
  transaction rollback. In-memory doubles cannot prove these.
- **End-to-end** for the journeys that must never break, not for field-level validation.

A test that would pass against a broken implementation is not worth writing.

## Commits and pull requests

- Branch names: `feat/<ticket>-<slug>`, `fix/<ticket>-<slug>`, `chore/<slug>`.
- One coherent, tested change per commit. Explain _why_ in the body; the diff already
  shows what.
- A pull request must state what was verified and how. If something is unverified, say so
  explicitly rather than leaving it implied.
- All four CI checks must pass. See [`.github/workflows/README.md`](../../.github/workflows/README.md).
