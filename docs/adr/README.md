# Architecture decision records

The decisions that shape MorrowList, extracted from section 6 of the product
specification (FND-011). Each record states the decision, why it was taken, and what
it costs, so a future change is a deliberate reversal rather than an accident.

| ID                                                   | Title                              | Status   |
| ---------------------------------------------------- | ---------------------------------- | -------- |
| [ADR-001](001-canonical-task-model.md)               | Canonical task model               | Accepted |
| [ADR-002](002-board-is-a-view-not-a-container.md)    | Board is a view, not a container   | Accepted |
| [ADR-003](003-modular-monolith-for-mvp.md)           | Modular monolith for MVP           | Accepted |
| [ADR-004](004-rest-openapi-over-browser-only-rpc.md) | REST/OpenAPI over browser-only RPC | Accepted |
| [ADR-005](005-cli-is-a-product-interface.md)         | CLI is a product interface         | Accepted |
| [ADR-006](006-agent-ready-not-agent-powered.md)      | Agent-ready, not agent-powered     | Accepted |
| [ADR-007](007-relationships-now-graph-later.md)      | Relationships now, graph later     | Accepted |
| [ADR-008](008-online-first-pwa.md)                   | Online-first PWA                   | Accepted |
| [ADR-009](009-manual-ordering-is-authoritative.md)   | Manual ordering is authoritative   | Accepted |
| [ADR-010](010-personal-first-workspace-model.md)     | Personal-first workspace model     | Accepted |
| [ADR-011](011-blocked-is-a-relation-or-a-flag.md)    | Blocked is a relation or a flag    | Accepted |
| [ADR-012](012-recurring-tasks.md)                    | Recurring tasks                    | Accepted |

## Adding a record

Copy the shape above: state the decision, the reasoning, and the consequences —
including what the decision makes harder. A record is never edited to reflect a new
decision; supersede it with a new record and mark the old one `Superseded by ADR-NNN`.
