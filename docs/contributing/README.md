# Contributing to MorrowList

## Local setup

Prerequisites: Node.js 24, pnpm (via `corepack enable pnpm`), and PostgreSQL 18.

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
pnpm db:migrate               # applies migrations from an empty database
pnpm dev                      # http://localhost:3000
```

For PostgreSQL either run `docker compose -f infra/compose/docker-compose.yml up -d`, or
install it natively and create two databases: one for development and one for tests. The
integration harness truncates every table, so it refuses to run when `TEST_DATABASE_URL`
is unset or equal to `DATABASE_URL`.

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

## Architecture rules

These are enforced by `pnpm lint`, not by memory. See [ADR index](../adr/README.md) and
section 16.2 of the specification.

- `domain` imports no framework, database, HTTP, auth provider, or UI — and no other
  workspace package. It is the innermost layer.
- `application` imports `domain` and `contracts` and defines ports. It does not import
  Next.js, Hono, Drizzle, or Better Auth.
- `database` and `auth` implement application ports. They are adapters.
- `api` validates input, builds an `ActorContext`, and calls exactly one use case. It
  contains no business rules.
- `web` never imports Drizzle schema or repositories. The single exception is
  `apps/web/lib/server.ts`, the composition root, which wires the adapters together.
- `cli` talks to the public API through `api-client`. It never reaches PostgreSQL.
- Cross-package imports use public entry points. No deep imports into another package's
  internals.

`packages/config/boundary-fixtures/` holds deliberately invalid files, and
`scripts/check-boundaries.mjs` fails the build if any of them lints clean. A rule that has
silently stopped matching is worse than no rule: it looks like enforcement while enforcing
nothing.

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
