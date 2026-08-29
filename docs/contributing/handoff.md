# Project handoff

State of the repository as of the end of Milestone M0, one vertical slice, and Step 0
(surface the model). Written so a contributor with no prior context can continue without
re-deriving decisions.

## What exists

M0 complete, plus a slice through every layer: sign up → capture into the Inbox → list →
complete → reopen, working from both the browser and the `morrow` CLI. On top of that,
Step 0 surfaced the model in the UI: task detail with autosave and conflict handling
(panel plus `/tasks/{idOrKey}`), priority and dates on capture and in row actions,
Completed and Trash views, and filter/sort controls whose state lives in the URL.

```
domain → application → {database, auth, api} → {web, cli}
```

`packages/domain` imports no framework and no other workspace package. Boundaries are
enforced by ESLint, by `scripts/check-boundaries.mjs` (which proves the lint rules still
fire), and by pnpm's strict `node_modules` layout.

Implemented endpoints: `GET /health`, `/ready`, `/me`, `GET|POST /tasks`,
`GET /tasks/{idOrKey}`, `PATCH /tasks/{id}`, `POST /tasks/{id}/complete|reopen|restore`,
`DELETE /tasks/{id}`. `GET /tasks?deleted=true` returns the Trash.

Not implemented despite appearing in the spec: projects/statuses endpoints, Today/Upcoming
/board/search/export projections, tags, relations, subtask endpoints,
`GET /tasks/{id}/activity`, `DELETE /tasks/{id}/permanent`, idempotency middleware,
API keys.

## Environment

- Node 24.20.0, pnpm 10.15.0 via corepack, PostgreSQL 18.6 via Homebrew (running as a
  LaunchAgent). No Docker on this machine.
- `psql` needs `export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"`.
- Load env before running anything: `set -a && source ./.env && set +a`.
- Databases: `morrowlist` (dev), `morrowlist_test` (integration harness),
  `morrowlist_e2e` (Playwright). Each suite refuses to run unless its own URL is set and
  differs from `DATABASE_URL`.
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
10. **Workspace packages are consumed from `dist/`.** `next dev` transpiles the built
    output, not the TypeScript source, so a change under `packages/` needs a build and a
    dev-server restart before the browser sees it. An hour was lost to a "broken" filter
    that was only a stale module.
11. **Do not render Markdown through an HTML string.** `features/tasks/lib/markdown.ts`
    parses to a tree and the renderer emits React elements, so raw HTML in a description
    cannot execute. Swapping in a Markdown library that returns HTML would silently
    delete that property (spec 8.1).
12. **The task detail serialises its saves.** Two field edits in quick succession are both
    dispatched before React re-renders, so the version to send comes from save responses
    (`version` ref), not from the rendered task. Removing the queue reintroduces a race
    that loses an edit with no error shown.

## Conventions

- Update `.claude/plans/<task-slug>.md` before coding and commit it with the code.
- One coherent, tested change per commit. Explain _why_ in the body.
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
- `DELETE /tasks/{id}/permanent` is not implemented, so Trash offers restore only, and
  the scheduled purge date spec 9.7 asks for has nowhere to come from.
- The list endpoint cannot sort by `completedAt`, so Completed falls back to
  `updatedAt desc` (spec 9.6 asks for completion time).
- `GET /tasks/{idOrKey}` 404s on a soft-deleted task, so `/tasks/{key}` cannot open one
  and Trash rows are not links to detail.
- The development database still holds nine `E2E Tester` workspaces left by earlier runs.
  Playwright no longer writes there, but the existing rows have not been cleaned out.
