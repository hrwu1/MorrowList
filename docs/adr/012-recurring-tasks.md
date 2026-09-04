# ADR-012 — Recurring tasks are in scope, created on completion

**Status:** Accepted

**Date:** 2026-09-04

## Context

Spec §2.4 lists "Recurring tasks, notifications, or reminders" among the MVP's explicit
non-goals, and §2.3 places recurrence in the long-term goals. The competitor gap
analysis (`docs/research/competitor-gap-analysis.md`) ranks repeating tasks as table
stakes for the persona: water the plants, pay the rent, weekly review. The roadmap's
closing note moves recurrence, reminders, calendar, start/defer dates and
natural-language capture from §2.4 into scope ahead of the graph view; this record covers
recurrence.

## Decision

1. **§2.4 is amended:** recurring tasks are in scope. Notifications and reminders remain
   out of scope until their own record (GAP-13).
2. **A rule lives on the task.** `tasks.recurrence` holds one canonical JSON rule —
   `daily | weekly | monthly | yearly`, an interval, a weekday set, a day of month or an
   nth weekday, a `schedule | after_completion` mode, and an optional end date or count.
   There is no RRULE engine and no RRULE import; GAP-14 maps this subset to ICS.
3. **The next occurrence is created on completion, in the same transaction.** Completing
   a task with a rule inserts the next occurrence (same title, description, priority,
   project in its default stage, parent, tags, due time and timezone; due date from the
   rule; defer date and deadline moved with the due date, see the date rules), records `task.created` with `seriesId` and `spawnedFrom` on it, and records
   `task.completed` on the old one. The rule moves to the new task; the completed one
   keeps only its `series_id`.
4. **A series is the id of its first occurrence.** `tasks.series_id` is set when a rule is
   first given to a task, copied to every occurrence spawned from it, and kept when the
   rule is later cleared, so the history of a stopped series stays linked.
5. **Skip advances the same task.** `POST /tasks/{id}/skip` moves a repeating task on to
   its next date (and counts the occurrence) without completing it, recording
   `task.occurrence_skipped`. The last occurrence of a bounded series cannot be skipped.
6. **Editing a rule affects the future only.** Each occurrence carries its own copy of the
   rule; completed occurrences have none, so nothing already recorded changes.

## Date rules

- The next date is the first date strictly after the anchor that matches the rule, with
  intervals anchored at the anchor's own day, week (Monday start), month, or year.
- `schedule` anchors at the due date (falling back to the completion date when the task
  has none) and then moves past the completion date: an overdue daily task completed
  today spawns tomorrow, not another overdue copy. `after_completion` anchors at the
  completion date. The completion date is the workspace-local calendar date (spec §12.3).
- Monthly on the 29th–31st lands on the last day of shorter months and springs back to
  the stored day afterwards, because the rule stores the day rather than deriving it from
  the previous date. Yearly anchors at the previous occurrence's month and day, so a
  29 February occurrence continues on 28 February in common years.
- `count` is the number of occurrences left including the current one. The spawned copy
  carries `count - 1`; `count: 1`, or a next date after `until`, ends the series: the
  last completion creates nothing and drops the rule.
- The defer date and deadline (GAP-16) are a window around the due date, so they move to
  the next occurrence by the same number of days as the due date, on spawn and on skip;
  the deadline time travels with the deadline. A task without a due date has no window
  to move: a spawned occurrence starts without those dates, and a skipped task keeps its
  own.

## Consequences

- No scheduler, cron, or background job: nothing runs while the user is away, nothing can
  double-create, and the behaviour will hold in an offline-later client because the whole
  step is one command on one task.
- A series only advances when the user acts. A task that repeats daily and is ignored for
  a week has one overdue occurrence, not seven; the catch-up rule above makes the next
  one land in the future.
- Reopening a completed occurrence does not resurrect its rule; the live occurrence
  already carries it. Reopening and completing again therefore cannot spawn twice.
- Only the complete command spawns. Completion that happens through a column — dragging
  a card into Done, a column becoming a Done column, or an archived column's tasks
  landing in Done — goes through the move policy, which completes the task and leaves
  its rule in place; the next occurrence is created once the task is reopened and then
  completed by the command or skipped.
- Completing a repeating task in an archived project fails, because the next occurrence
  has nowhere to go; clearing the rule first is the way out.
- The grammar is deliberately smaller than RRULE (no `BYSETPOS` lists, no hourly rules,
  no exceptions). Extending it is a code change to the domain module and the contract,
  not a migration, because the column is JSONB.
- The spec's own wording in §2.4 is superseded by this record; the spec file itself is
  not edited.
