# ADR-004 — REST/OpenAPI over browser-only RPC

**Status:** Accepted

**Date:** 2026-08-28 (adopted with the v1.0 specification)

## Decision

**Decision:** Expose `/api/v1` as a versioned REST API documented by OpenAPI 3.1.

**Rationale:** Future agents, CLIs, scripts, GitHub Apps, and third-party integrations may not use TypeScript. A language-neutral contract is more important than maximizing browser-only type inference.
