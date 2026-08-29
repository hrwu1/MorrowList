# ADR-002 — Board is a view, not a container

**Status:** Accepted

**Date:** 2026-08-28 (adopted with the v1.0 specification)

## Decision

**Decision:** A project owns tasks and workflow statuses. A board groups project tasks by those statuses.

**Consequences:**

- A task belongs to one primary project at a time.
- A project can later expose several saved board configurations without duplicating tasks.
- Moving between columns changes `status_id` and ordering rank.
