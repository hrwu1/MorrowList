# ADR-NNN — Start/defer dates and deadlines are in scope

**Status:** Proposed (numbered at merge)

**Date:** 2026-09-04 (GAP-16)

## Decision

**Decision:** A task carries three date-only fields with distinct meanings: `deferUntil`
(the task is hidden from Today, Upcoming, the Inbox and the board until that day),
`dueDate` (the planned day, unchanged in the API and labelled "Planned" in the UI), and
`deadline` with an optional wall-clock `deadlineTime` (the hard limit, shown as its own
marker). This moves start/defer dates out of the specification's §2.4 non-goals, ahead of
the graph view and alongside recurring tasks, reminders, and calendar, as the roadmap's
closing note records.

Deferral and "past deadline" are evaluated by date comparison against the workspace's
calendar date at read time, in the same way a My Day selection expires (ADR-001): no job
rewrites a task when its defer date arrives. The order `deferUntil ≤ dueDate ≤ deadline`
is expected but not enforced; the API reports `dateWarnings` so a client can warn.

**Consequences:**

- Today, Upcoming, the Inbox list, and the project board apply one deferral predicate in
  the domain and in SQL, and expose explicit `deferred` and `includeDeferred` switches so
  a view can still show what is hidden.
- Overdue stays a `dueDate` question; a deadline marker is loud only when it is past or
  within the next two days, so the planned day keeps its meaning as the day to act.
- `task.updated` gains three additive fields in its `changes` diff; no event payload
  shape changes. Export (GAP-07) and natural-language capture (GAP-15) must carry the
  three dates when they land.
- `deadlineTime` has no timezone column of its own; it is read in the workspace timezone.
  A later decision may add one if per-task zones become necessary.
- On a repeating task (ADR-012) the defer date and deadline move to the next occurrence
  by the same number of days as the due date, on spawn and on skip; without a due date a
  spawned occurrence starts without them and a skipped task keeps its own.

---
