# ADR-0XX — Ten typed custom fields, and no more

**Status:** Proposed

**Date:** 2026-09-05 (GAP-24)

## Context

Custom fields are the single most requested capability in the competitor set: they are
Vikunja's top open request, and every tool that has them is defined by how it answered the
question. Two answers are on record as cautionary tales. Jira lets an instance accumulate
custom fields without limit — installations with dozens per issue type are ordinary, and
the cost lands on the issue screen, on search, and on the index. Notion's databases are
open-ended enough that a page's property set becomes a schema nobody owns, and large
databases get slow in ways users cannot diagnose.

Both failures share a shape: the field system is a general-purpose data modeller bolted to
a task tracker, so the task stops being a task. MorrowList's whole premise (spec 2, ADR-001)
is one canonical task, and its performance budget (spec 29.2) assumes a list read is a
bounded query over one table.

## Decision

**A workspace may define at most ten fields, of exactly four types — `select`, `number`,
`date`, `text` — and their values live in one `jsonb` column on the task.**

Three parts, each load-bearing:

1. **The cap of ten** is enforced in `FieldService.create`, counted inside the transaction
   that would create the eleventh, and reported as `FIELD_LIMIT_REACHED`. It is not a
   quota to be raised on request: ten fields is the point at which a task detail still
   reads as a task, and the refusal is what stops the Jira outcome from arriving one
   reasonable request at a time.

2. **Four types, closed.** `select` (a fixed option list), `number`, `date`, `text`. No
   formulas, rollups, relations-as-fields, per-project fields, or required fields. Each of
   those turns the field system into a modelling language, and each is the first step of
   the Notion outcome. The four chosen types are what a filter can express usefully:
   equality on all of them, ordering on the two that have an order.

3. **Values on the task row.** `tasks.fields jsonb not null default '{}'`, keyed by the
   definition's stable `key`, with a GIN index. Not an entity-attribute-value table: a
   task's values come back with the task, so no projection needs an extra query and
   `loadTaskDtos` is unchanged. Field values are part of the canonical task (ADR-001), not
   a second model beside it.

The filter operators follow from the types: `eq`, `ne`, `lt`, `gt`, `between`, `empty`,
with the ordering four offered only for `number` and `date`. One grammar spells a filter
everywhere — `<key>:<op>[:<value>]` — so the search box, the CLI's `--where`, a saved view
and the list URL all carry the same string.

## Consequences

- A workspace that needs an eleventh field must decide which of the ten it no longer
  needs. That conversation is the feature.
- The key and the type of a definition are immutable: changing either would reinterpret
  values already stored on tasks. A field is deleted and recreated instead, which is
  visible and reversible-by-hand rather than silent.
- Deleting a definition removes its key from every task in the same transaction and
  records the affected count, so no value can outlive its meaning.
- Equality filters are answered by the GIN index; the ordering comparisons extract the
  value and compare it as `jsonb`, which costs a scan of the workspace's rows — the same
  budget the existing priority filter spends. Measured at 10,000 tasks, an equality
  filter returns a page in single-digit milliseconds.
- Values are typed but schemaless in the column, so adding a fifth type later would be a
  migration of the definitions table only. That is deliberately possible and deliberately
  not done.
