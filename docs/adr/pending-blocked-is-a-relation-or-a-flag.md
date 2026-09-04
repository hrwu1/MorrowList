# ADR-NNN — Blocked is a relation or a flag; the Blocked column is a view

**Status:** Proposed (numbered at merge; GAP-06)

**Date:** 2026-09-03

## Decision

**Decision:** A task is blocked when an incomplete `blocks` predecessor exists or when
the task carries an explicit blocker flag `{ reason, since }`. Blocked state is a
projection (`isBlocked`) computed from those two sources; it never forces a workflow
status change. The default `Blocked` workflow status (spec 9.5) is kept as an ordinary
column that users may still move work into, with a hint that the flag is the preferred
signal. Completing a blocked task requires an explicit acknowledgement.

## Reasoning

- Spec 8.4 already says the indicator "does not force the workflow status to Blocked;
  it warns and offers a status change", and that a user may complete a blocked task
  after a warning. A column-as-state model contradicts both: a card parked in
  `Blocked` loses the stage it was actually in, and blocked time cannot be measured.
- Linear and Plane model blocking as a relation with a reason; the Kanban guides ask a
  workflow to define and signal blockers. A flag with a reason and a start time gives
  GAP-17 the blocked-time metric for free from `task.blocked` / `task.unblocked`.
- Keeping the column avoids a migration of existing workflows and respects ADR-002:
  the board groups by status, it does not own a competing "blocked" model (ADR-001).

## Consequences

- `tasks.blocked_reason` and `tasks.blocked_since` are set and cleared together; the
  flag survives completion so a reopened task shows the same reason.
- `blocks` relations are stored in `task_relations`; cycles are rejected. A relation
  to a task in the Trash is hidden and does not block until the task is restored.
- `POST /tasks/{id}/complete` answers `TASK_BLOCKED` unless `acknowledgeBlocked` is
  set. Moving a card into Done by drag is not gated; a later ADR may revisit that.
- The `Blocked` column stays; a workflow-editing plan (GAP-05) may archive it per
  project without affecting blocked state.
