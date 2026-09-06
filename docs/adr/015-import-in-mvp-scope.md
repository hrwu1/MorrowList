# ADR-015: Import is in scope, and the archive is the format it is judged against

- Status: accepted
- Date: 2026-09-05
- Supersedes: the "Import UI is deferred" sentence in spec 30.2

## Context

Spec 30 puts a versioned JSON export in the MVP and defers import: "Import UI is
deferred, but a validation library and round-trip test fixture should make future import
possible." The competitor gap analysis (`docs/research/competitor-gap-analysis.md`)
reached the opposite conclusion about sequencing. Export answers the lock-in objection,
which is a reason to _stay_; an importer is the reason to _arrive_. A task manager with
nothing to import from is a task manager someone has to retype their work into, and the
research identified a Trello importer as the single largest migration wedge.

Deferring import also leaves the export format untested in the only way that matters. A
format nothing reads is a format nobody has checked is complete: the first import written
a year later is where the missing `rank` column, the absent blocked flag and the dropped
My Day history are discovered.

## Decision

1. **Import ships with export, in the MVP.** `POST /imports/{source}` takes a Trello board
   export or a CSV and creates one project. A Settings › Data page and
   `morrow import trello|csv` cover the two interfaces MorrowList treats as peers
   (ADR-005).

2. **Every import previews first.** `?dryRun=true` runs the same mapping and writes
   nothing. Creating a project full of tasks is not undoable in the MVP, so a person sees
   the columns, the tags, the counts, the fields that will be ignored and the rows that
   will be refused, and then approves. The preview and the apply share one pure mapping in
   `packages/domain/src/import/`, so what is approved is what runs.

3. **One import is one transaction.** The project, its columns, its tags, every task and
   subtask, and every activity and outbox row commit together or not at all. A failure
   part-way leaves nothing behind rather than a half-imported project a person has to
   clean up by hand.

4. **An import creates, it never merges.** The project name must be free. Merging into an
   existing project would be the one import mistake with no way back.

5. **The archive is the canonical rows, not the read projections**, and it carries no
   derived table. `task_status_intervals` is rebuilt by `pnpm db:backfill-flow` and
   `task_reminders` is recomputed from each task's own offset, so neither travels. Adding
   a section is additive and does not bump `schemaVersion`; removing or reshaping one
   does.

## Consequences

- Spec 30.2's deferral of import no longer holds. The rest of section 30 stands, including
  the schema's shape and the rule that no auth material is ever exported — a property of
  the architecture here, since the auth-provider tables live behind `packages/auth` (spec
  18.3) and no repository the export transaction can reach exposes them.
- Two new scopes, `export:read` and `import:write`, because reading a whole workspace out
  and writing a whole project in are each wider than any per-resource scope.
- `task.created` gains an optional `importedFrom` payload member, exactly as recurrence
  added `spawnedFrom` (ADR-012). Additive and optional; no existing payload changes shape.
- A new event, `workspace.imported`, records what one import created.
- Jira and Asana get no dedicated importer. Both export CSV, and the CSV path reads the
  column names they use; a dedicated importer is worth writing only when a real export
  proves the generic one insufficient.
- Scheduled backups (spec 30.3) stay operational, not a product feature. `morrow export
--out` on a cron is the supported answer for a self-hoster.
