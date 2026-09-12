# Structure standardization — completed 2026-09-12

The user resumed the paused checkpoint with “Please continue”. The reviewed
standardization is now merged into local `main`, ending at implementation commit
`ff59252`; this documentation commit follows it. No changes were pushed.

The existing guideline is in
[the maintained roadmap](../../.claude/plans/roadmap.md#structure-standardization-guideline-2026-09-12).
[The contribution guide](README.md#patterns-for-equivalent-responsibilities) documents
the patterns to maintain. There is no pending implementation stage for this review.

## What is standardized

The project keeps its modular monolith and ports/adapters architecture. Equivalent
responsibilities now share concrete policies rather than generic CRUD inheritance:

- Application commands reuse task persistence, transitions, projections and event
  recording. Imports emit canonical tag events while historical events remain readable.
- API lists, exports and OpenAPI share query conversion. Empty CLI tag selections stay
  empty; task deletion preserves expected versions; CLI/MCP share connection defaults
  and workspace environment precedence. Local JSON validation has consistent errors.
- Task caches share projection extraction, patching, snapshots, rollback, cancellation,
  invalidation and refresh. Feature query keys are canonical. Commands, shortcuts,
  bulk actions and undo preserve authoritative results and warnings.
- Feedback and undo are scoped to the current authenticated session. Late mutation/undo
  results cannot repopulate the next session, including the standalone capture route.
- Replay shares the command transaction, serializes duplicates with advisory locks,
  encrypts stored responses, and honors `IDEMPOTENCY_RETENTION_HOURS` (24 by default).
  User-owned push registrations do not require a workspace. Synchronous webhook tests
  remain explicitly outside replay because their external send cannot roll back.
- Custom-field limits serialize count-then-create in PostgreSQL. Batch WIP warnings
  describe the final committed state, including batches that return below the limit.
- Concrete HTTP/push delivery adapters and common embedded/external worker composition
  live in `@morrowlist/transports`; application ports remain in `application`.
  Notification dispatch has its own responsibility boundary. VAPID configuration errors
  do not delete healthy device registrations.
- ESLint and virtual boundary fixtures share the dependency matrix, public-entry-point
  rules and narrow exceptions, covering common import and ambient-fetch escape paths.

## Final verification

| Check                            | Result                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Unit tests                       | 1,630 passed                                                                   |
| Typechecks                       | All 15 package/app checks passed                                               |
| Full production build            | Passed; combined build/test/typecheck run completed 45/45 tasks                |
| PostgreSQL integration           | 145 passed across 19 files, with the final migration                           |
| Chromium production E2E          | 96 passed, retries disabled, including mobile viewports                        |
| Focused warning E2E              | 5 passed after the batch-warning correction                                    |
| ESLint and boundaries            | Passed, including 188 architecture checks                                      |
| Formatting and OpenAPI freshness | Passed                                                                         |
| External worker entry point      | Started, ticked and shut down cleanly against a disposable database            |
| Local main after update          | Health returned OK; fresh browser reached sign-in controls with no page errors |

The first focused browser run exposed an intermediate batch warning (two tasks when
three were committed). Regression tests failed before the fix and passed afterward;
the full final browser suite includes that scenario. Final review also connected the
existing replay-retention setting and tested both default and configured expiry edges.
Desktop WIP feedback and mobile capture screenshots were visually inspected.

Docker image execution was not tested: the CLI exists but the local Docker engine was
unavailable. Firefox/WebKit and real external email/push providers were not tested.
These limits are distinct from the passing local production build and Chromium suite.

## Local rollout and cleanup

- Main was fast-forwarded from `9b40b25`, preserving the clean checkout.
- Main dependencies use the normal `the pnpm store`; all package builds
  were refreshed and the new transport package resolves within the main checkout.
- Applied only `0020_idempotency_records.sql` to the local `morrowlist` database: the
  replay table and expiry index are additive. The prior 20 migrations were already
  present. Verification used disposable databases; no test accounts/tasks were added to
  development data.
- Restarted the existing development server at `http://localhost:3200` on the merged
  source. The direct migration CLI required an explicit `DATABASE_URL`; the normal
  `pnpm setup:dev` workflow manages local setup separately.
- Removed the four `morrowlist-standardize*` worktrees and all four task databases
  (`morrowlist_standardize_test`, `morrowlist_standardize_backend_test`,
  `morrowlist_standardize_e2e`, and `morrowlist_standardize_verify`). Original slice
  branches remain as history; their changes are already integrated. Unrelated historical
  worktrees were left alone.
- Removed the task’s temporary pnpm store. Verification logs and selected screenshots
  remain under `/private/tmp/` for inspection.

Future environments must apply migration 0020 through the normal migration/deployment
workflow. This task did not publish or deploy an external environment.

## Evidence locations

All paths below are local scratch artifacts, not repository dependencies:

- `/private/tmp/morrowlist-standardize-resume-final-terminal.log`
- `/private/tmp/morrowlist-standardize-resume-final-integration.log`
- `/private/tmp/morrowlist-standardize-resume-full-e2e.log`
- `/private/tmp/morrowlist-standardize-resume-feedback-e2e.log`
- `/private/tmp/morrowlist-standardize-resume-lint.log`
- `/private/tmp/morrowlist-standardize-resume-format.log`
- `/private/tmp/morrowlist-standardize-resume-openapi.log`
- `/private/tmp/morrowlist-standardize-resume-worker.log`
- `/private/tmp/morrowlist-standardize-main-migrate.log`
- `/private/tmp/morrowlist-standardize-main-dev.log`
- `/private/tmp/morrowlist-standardize-evidence/wip-warning.png`
- `/private/tmp/morrowlist-standardize-evidence/capture-mobile.png`

The earlier review remains at
`/private/tmp/morrowlist-structure-review-2026-09-12.md`. Commit `263c907` preserves the
paused handoff if historical stage details are needed. Use the final results above;
earlier logs include the diagnosed, corrected failures.

## Conventions to preserve

Keep rank columns `COLLATE "C"`, omitted/null semantics, expected-version checks and
transactional activity/outbox writes. Use canonical task DTOs and public package entry
points. Rebuild package `dist` after source changes before validating browser behavior.
Keep intentional bulk, import, capability-feed and notification-state differences;
matching responsibilities does not require identical syntax. Keep live provider and
container verification claims separate from local tests. Never push without a request.
