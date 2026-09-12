# Structure standardization handoff — 2026-09-12

## Stop point

The user asked: “Stop when you complete the current stage, and write the remaining work
as a handoff file.” The implementation/integration and terminal-check stage is the stop
point. Production build, browser validation, final merge, and cleanup remain pending.
Do not resume those stages until the user asks. Nothing has been pushed.

Work is preserved on `codex/standardize-structure` in
`/private/tmp/morrowlist-standardize`. Main at
`.` remains at `9b40b25`; it has not received these
changes. Use the integration checkout for all continuation work. Read
[the existing guideline](../../.claude/plans/roadmap.md#structure-standardization-guideline-2026-09-12)
and [the contribution patterns](README.md) before editing. Keep the guideline current;
do not create another plan for the same work.

## Implemented

- API lists, exports, and OpenAPI share task-query conversion; CLI exports preserve an
  empty tag selection. Task deletion carries an expected version. CLI/MCP share API
  connection defaults and workspace environment precedence; malformed local JSON has the
  same usage-error classification.
- Web task projections share extraction, patching, snapshots, rollback, cancellation,
  invalidation, and background refresh. Resource query keys have one canonical source.
  Task commands, bulk actions, shortcuts, and undo preserve warnings and authoritative
  results. The cache regression covers parent/subtask counts after optimistic updates.
- Imports use canonical tag events and task transitions; Today/Upcoming use shared task
  projections. Custom-field count-then-create locks the workspace, preserving the cap
  under concurrent PostgreSQL requests.
- Concrete delivery adapters and shared embedded/external worker wiring now live in
  `@morrowlist/transports`. Application ports remain in `application`. Notification
  dispatch is separated from its public service facade. Invalid VAPID configuration no
  longer marks healthy push registrations as permanently gone.
- Server idempotency joins nested UnitOfWork calls and commits replay with command writes.
  Advisory locks serialize duplicates. Replay responses are encrypted and retained for
  24 hours; changed fingerprints return 409 and failed transactions leave no record.
  Device registration uses user scope with nullable workspace ownership. Synchronous
  webhook tests are explicitly excluded because their external send cannot roll back.
  Refreshing an expired record precedes bounded cleanup to avoid opposing row locks.
- ESLint and executable virtual fixtures share a dependency matrix, enforce public
  package entry points, and cover relative/alias/dynamic/re-export/require escapes plus
  ambient fetch and narrow tooling exceptions. Next includes the new transport package
  in transpilation, and Docker copies its package manifest.

The final checkpoint also includes session isolation for task feedback and undo; see the
commit log and terminal results below. Preserve this guard when changing mutation hooks.

## Verification at the checkpoint

Implementation head: `ac4fd8a` (the documentation checkpoint follows it). All current
implementation slices are committed. The final combined terminal run passed:

- **1,628 unit tests**, including 393 web, 349 application, 159 CLI, and 100 API tests.
- **15 package/app typechecks**; the combined Turbo run completed all 42 tasks.
- ESLint plus **188 architecture checks**, full formatting, and OpenAPI freshness.

The maintained roadmap records the same checkpoint. The database evidence has a
narrower scope:

- Full PostgreSQL integration: **144 tests across 19 files passed** before the final
  nullable replay-schema change. This includes concurrent field-limit enforcement.
- Final focused replay PostgreSQL suite: **4 tests passed** using
  `morrowlist_standardize_backend_test`, with the final nullable migration applied fresh.
  It covers independent concurrent callers, nested rollback, conflicting key reuse, and
  user-scoped registration without workspace membership.
- API replay/route/OpenAPI unit suite: **100 tests passed** after the replay fixes.
- No production Next build or Playwright journey was run for this integrated checkpoint.
  Passing unit tests do not establish browser behavior or live-provider delivery.

Logs are local scratch artifacts under `/private/tmp/`:

- `morrowlist-standardize-stage-checks.log`: final combined typecheck/unit result.
- `morrowlist-standardize-stage-lint.log`: ESLint and boundary fixtures.
- `morrowlist-standardize-stage-format.log`: formatting result.
- `morrowlist-standardize-stage-openapi.log`: OpenAPI freshness.
- `morrowlist-standardize-integration.log`: the earlier 144-test PostgreSQL run.
- `morrowlist-standardize-replay-final-unit.log`: the final 100-test API run.

Older `combined-*` and `final-checks.log` files include superseded attempts: a sandboxed
CLI listener was denied, and a middleware integration typo failed typecheck/lint before
it was fixed. Use the final `stage-*` results, not those earlier failures.

## Remaining work when resumed

1. Verify the integration branch/worktree and clean status against this handoff. Check
   current main before any merge; preserve unrelated user edits. Review the final diff,
   especially the session guard and replay exceptions. Do not broaden the refactor.
2. Run the complete PostgreSQL suite against an empty task-specific database using the
   final migration. `morrowlist_standardize_test` contains an earlier NOT NULL version of
   the new `0020` migration; recreate **only that disposable task database**, or choose a
   fresh task database. Do not alter the development database or reuse its URL for tests.
3. Build the full production workspace. Check packaging of `@morrowlist/transports`, the
   web bundle/service worker, and the external worker entry point. TypeScript dependency
   builds from unit checks are not a production Next build. Docker-image validation is
   separate and remains unverified.
4. Run focused production Chromium journeys: `task-command-feedback.spec.ts`,
   `wip.spec.ts`, `undo-bulk.spec.ts`, and `background-sync.spec.ts`; cover shortcuts,
   capture/capture-channels, and offline-scope after the session guard; then the full suite
   with retries disabled. Inspect contextual warnings on desktop and mobile, optimistic
   subtask counts/rollback, bulk remedies, undo, shortcuts, and account/signout isolation.
   Capture and inspect screenshots where useful. Fix regressions and rerun affected
   checks; do not report browser success from unit tests.
5. Refresh terminal checks only for subsequent changes or unresolved concerns. Record
   precise results and remaining platform/provider gaps in this handoff/guideline.
6. After all required checks pass, merge cleanly into local main according to the user’s
   resume instructions, preserving existing changes. Do not push. Apply migrations to
   development/deployed environments only as an explicit rollout step, not as a test.
7. Remove this task’s four worktrees and temporary databases after successful integration.
   Stop only task-owned listeners. Leave unrelated historical/prunable worktrees alone.

## Environment and continuation commands

Node 24 and pnpm 10.15.0 are available. Each worktree has its own workspace dependency
links. The downloaded pnpm store was relocated out of main to
`/private/tmp/morrowlist-standardize-pnpm-store`; main is clean. If reinstalling, use:

```sh
cd /private/tmp/morrowlist-standardize
pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir /private/tmp/morrowlist-standardize-pnpm-store
```

PostgreSQL 18 tools are under `/opt/homebrew/opt/postgresql@18/bin`; the local database
role is `hrwu`. Task databases retained for continuation are:

- `morrowlist_standardize_test` — earlier migration; recreate before final full run.
- `morrowlist_standardize_backend_test` — final nullable migration, focused suite passed.
- `morrowlist_standardize_e2e` — reserved for browser tests, no browser suite run yet.

After preparing a fresh test database, the remaining checks can use:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/morrowlist TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/morrowlist_standardize_test pnpm test:integration
WORKER_MODE=external DATABASE_URL=postgresql://postgres@127.0.0.1:5432/morrowlist_standardize_e2e AUTH_SECRET=standardization-local-test-secret-at-least-32-characters APP_URL=http://127.0.0.1:3280 pnpm build
CI=1 E2E_PORT=3280 DATABASE_URL=postgresql://postgres@127.0.0.1:5432/morrowlist E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/morrowlist_standardize_e2e AUTH_SECRET=standardization-local-test-secret-at-least-32-characters pnpm --filter @morrowlist/web test:e2e task-command-feedback.spec.ts wip.spec.ts undo-bulk.spec.ts background-sync.spec.ts --retries=0
```

For the full browser suite, retain that environment and omit the four filenames. Verify
port 3280 is free first; Playwright starts its own production server and refuses reuse.
The `DATABASE_URL` pointing at dev in test commands is only a safety comparison; the
harness selects `TEST_DATABASE_URL`/`E2E_DATABASE_URL`. Never run migration/seed commands
with that dev URL. Socket/network tests and Git metadata mutations required sandbox
escalation in this session; request tool approval if the same restrictions recur.

Retained worktrees/branches:

| Worktree                                         | Branch                         |
| ------------------------------------------------ | ------------------------------ |
| `/private/tmp/morrowlist-standardize`            | `codex/standardize-structure`  |
| `/private/tmp/morrowlist-standardize-interfaces` | `codex/standardize-interfaces` |
| `/private/tmp/morrowlist-standardize-backend`    | `codex/standardize-backend`    |
| `/private/tmp/morrowlist-standardize-web`        | `codex/standardize-web`        |

Agent commits have already been cherry-picked into the integration branch. Do not merge
those branches again. Inspect `git log 9b40b25..HEAD` for the coherent implementation
steps. The earlier detailed review remains at
`/private/tmp/morrowlist-structure-review-2026-09-12.md`.

## Durable project constraints

Keep rank columns `COLLATE "C"`; Drizzle does not express this collation. Preserve omitted
versus null semantics and expected-version checks. Keep canonical task DTOs and stable
public package interfaces; do not replace feature-specific policies with generic CRUD
inheritance. Package source changes require rebuilt `dist` before the browser consumes
them. API and CLI documentation must agree with executable behavior. Use generated test
accounts in disposable databases, never historical credentials from old handoffs.
