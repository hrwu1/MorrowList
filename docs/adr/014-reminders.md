# ADR-014 — Reminders and notifications in scope

**Status:** Accepted

**Date:** 2026-09-04

## Decision

**Decision:** Move reminders and notifications from the specification's MVP non-goals
(§2.4) into scope, ahead of the graph view, and create the `notifications` table that §18.4
listed as future. The scope is deliberately narrow and bounded by a "no notification floods"
rule:

- One reminder per task, fired once, at an offset before the task's due time (default 30
  minutes; changeable per task and, as a default for new timed tasks, per user and
  workspace). A task without a due time has no reminder; completing or trashing a task
  cancels its pending reminder; the only snooze offered is "remind me in one hour".
- At most one digest a day per user and workspace, at a time the user chooses in their
  own timezone, containing the Today view; an empty Today sends nothing.
- Channels are opt-in beyond the in-app inbox: email through the existing
  `EMAIL_PROVIDER` adapter, and web push once the service worker (GAP-11) exists. Nothing
  is sent by a channel the user has not switched on, and a workspace never emails
  someone who did not configure it.
- Delivery is a small polling worker over a `task_reminders` schedule that is recomputed
  inside every task command's transaction and claimed with `FOR UPDATE SKIP LOCKED`, so
  several workers can run and a reminder is still delivered once. It runs embedded in the
  web process by default (`WORKER_MODE=embedded`) or as `pnpm worker`; it is not a queue,
  broker, or agent runtime (ADR-006 still holds).

## Reasoning

The competitor gap analysis found reminders to be table stakes for a personal task
manager: a due time that never tells you it has arrived is a date, not a plan. The
existing outbox and Today projection already provide the two ingredients — a
transactional event trail and a definition of "due today" — so the cost is a schedule
table, a delivery loop, and an inbox, not new infrastructure.

The spec's non-goal was written to avoid the manipulative notification patterns it warns
against in §15 and §26. The bounded rules above are the answer to that concern: reminders
are per task and once, digests are daily and only when there is something to say, and
every channel beyond the inbox is opt-in.

## Consequences

- The specification's §2.4 non-goal list and §18.4 future-table list are amended when
  this record is numbered; the `notifications`, `notification_preferences`,
  `task_reminders`, and `push_subscriptions` tables exist from migration 0005.
- Delivery records `task.reminder_sent`, `task.reminder_snoozed`, `workspace.digest_sent`,
  and `workspace.notification_preferences_updated` in the activity and outbox streams, on
  the aggregates users already read, rather than a new aggregate type. Marking a
  notification read is per-user view state and records no event; push registrations are
  credentials and record none either.
- Email addresses are read through a `UserDirectory` port implemented in `@morrowlist/auth`,
  keeping the provider tables behind that package (§18.3). Email is sent after the
  claiming transaction commits and is not retried; the in-app row is the durable record.
- The push channel is incomplete until GAP-11 ships a service worker: registrations are
  stored and exposed on the API, but nothing is pushed and no VAPID configuration exists
  yet. Adding it later changes no contract.
- What this makes harder: a second reminder per task, per-project channels, SMS, or
  location reminders would all need a deliberate reversal of the flood rule, not a flag.
