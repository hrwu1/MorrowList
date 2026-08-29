# ADR-001 — Canonical task model

**Status:** Accepted

**Date:** 2026-08-28 (adopted with the v1.0 specification)

## Decision

**Decision:** Store one canonical Task entity. Board cards and TODO rows are projections of it.

**Consequences:**

- Completion and status changes are globally consistent.
- Today membership is a dated planning relation, not a copied task.
- Future graph nodes reference task IDs.
- CLI and API semantics remain clear.
