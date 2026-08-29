# Project handoff

State of the repository as of the end of Milestone M0 plus one vertical slice. Written so
a contributor with no prior context can continue without re-deriving decisions.

## What exists

Seven commits. M0 complete, plus a slice through every layer: sign up → capture into the
Inbox → list → complete → reopen, working from both the browser and the `morrow` CLI.

```
domain → application → {database, auth, api} → {web, cli}
```

`packages/domain` imports no framework and no other workspace package. Boundaries are
enforced by ESLint, by `scripts/check-boundaries.mjs` (which proves the lint rules still
fire), and by pnpm's strict `node_modules` layout.

Implemented endpoints: `GET /health`, `/ready`, `/me`, `GET|POST /tasks`,
`GET /tasks/{idOrKey}`, `PATCH /tasks/{id}`, `POST /tasks/{id}/complete|reopen|restore`,
`DELETE /tasks/{id}`.

Not implemented despite appearing in the spec: projects/statuses endpoints, Today/Upcoming
/board/search/export projections, tags, relations, subtask endpoints,
`GET /tasks/{id}/activity`, `DELETE /tasks/{id}/permanent`, idempotency middleware,
API keys.

## Environment

- Node 24.20.0, pnpm 10.15.0 via corepack, PostgreSQL 18.6 via Homebrew (running as a
  LaunchAgent). No Docker on this machine.
- `psql` needs `export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"`.
- Load env before running anything: `set -a && source ./.env && set +a`.
- Databases: `morrowlist` (dev), `morrowlist_test` (integration harness).
- Dev server: `pnpm --filter @morrowlist/web dev` → http://localhost:3000
- Test account: `robin@example.com` / `correct-horse-battery-staple`

## Gotchas that will cost you an hour each

1. **Rank columns must stay `COLLATE "C"`** (migration `0001_rank_collation.sql`). Drizzle
   does not model column collation, so a regenerated migration will not include it. Under
   the default `en_US.UTF-8` collation PostgreSQL sorts `aa` before `aZ` and adjacent
   tasks silently swap. An integration test guards this — do not "fix" it by deleting it.
2. **`pnpm db:generate` builds first**, because drizzle-kit bundles as CommonJS and cannot
   resolve the `.js` specifiers in the TypeScript source. It reads `dist/schema/index.js`.
3. **`exactOptionalPropertyTypes` is on.** Optional component props must be declared
   `?: T | undefined`, or passing an explicit `undefined` fails to typecheck.
4. **PATCH distinguishes omitted from null.** An absent key leaves a field unchanged; an
   explicit `null` clears it. Do not collapse these — there are tests for it.
5. **`apps/web` may not import `@morrowlist/database`.** The single exception is
   `apps/web/lib/server.ts`, the composition root, which is excluded in the boundary rule.
6. **Do not redeclare a root CLI flag on a subcommand.** Commander lets the root
   definition win wherever the flag appears, silently discarding the subcommand's value.
7. **The specification `.md` is Prettier-ignored.** It is a source document; do not
   reformat it.
8. **Regenerate OpenAPI when contracts change**: `pnpm openapi:generate`, then commit.
   CI fails on drift.
9. Vitest in `apps/web` excludes `e2e/`; Playwright owns that directory.

## Conventions

- Update `.claude/plans/<task-slug>.md` before coding and commit it with the code.
- One coherent, tested change per commit. Explain *why* in the body.
- Commit trailers:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01GxZf3aH2z4qujvS7Dqn7ev`
- Never push; no remote is configured.
- Match the test to what can break: unit for pure policy, integration for anything
  depending on SQL semantics, E2E only for journeys that must never break.
- Report what was verified and what was not. State unverified work explicitly.

## Known debt

- **IDEM-001 is a real correctness gap**: the CLI sends `Idempotency-Key` on every
  mutation and the server ignores it, so a retry after a timeout duplicates a task.
- AUTH-005: CLI authenticates with session tokens; scoped API keys not built.
- AUTH-006: timezone hardcoded to UTC at sign-up; no onboarding screen.
- VIEW-008: no undo.
- Playwright runs against the development database and has left junk workspaces in it.
