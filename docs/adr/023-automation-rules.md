# ADR-023 — Bounded personal automation rules

**Status:** Accepted

**Date:** 2026-09-07

## Decision

Run a fixed typed catalogue of task triggers, conditions and actions after commit in the
existing worker. Rules are workspace configuration, audited on the workspace aggregate.
No arbitrary scripts, cross-workspace actions, AI, or schedules beyond due.today.

A unique rule/event receipt and all task mutations commit atomically. Receipts scan the
outbox independently of webhook publication. Rule creation, editing and re-enabling
establish a new eligibility instant; past events are not replayed. Failed runs are terminal
and visible, with their actions rolled back. No daily run quota; ticks have finite batches.

All descendants of rule actions carry the existing causationId envelope field and are
ineligible for every rule. This intentionally prevents automation chains as well as loops.
Activity names the rule through the existing actor display name. Existing persisted
payloads and the event schema version remain unchanged.

The daily trigger uses workspace timezone and a durable rule/task/date receipt. A webhook
action queues a delivery to an existing active workspace subscription configured for rule-only delivery (reserved
`rule.only` filter, excluded from normal fanout), reusing its signing,
SSRF protection, retries and delivery log. Rule success means queued, not delivered.

## Consequences

Task policies remain in public services bound to the claiming transaction. No action may
partially survive a failed run. Settings expose bounded typed forms and a read-only dry run;
API and CLI expose the same contracts. New triggers/actions require a reviewed contract
extension, not user code execution. Forward migrations can remove these additive tables.
