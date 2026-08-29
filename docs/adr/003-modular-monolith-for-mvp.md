# ADR-003 — Modular monolith for MVP

**Status:** Accepted

**Date:** 2026-08-28 (adopted with the v1.0 specification)

## Decision

**Decision:** Use one deployable Next.js application plus PostgreSQL, with domain, application, contracts, API, persistence, UI, and CLI separated into packages.

**Consequences:**

- Local development and self-hosting stay simple.
- The API can later be extracted because transport and business logic are already separate.
- No network calls are introduced between internal modules.
