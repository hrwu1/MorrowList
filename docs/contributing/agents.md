# Rules for agent contributors

MorrowList is built to be worked on by software agents as well as people (spec 43). These
rules exist because an agent has less context than a human contributor and cannot ask a
colleague over lunch.

## Before writing code

1. Read the ticket's _Owned files_ section. Do not modify files another ticket owns.
2. Read the ADRs relevant to the area. If the change contradicts one, stop and say so
   rather than quietly working around it.
3. Check whether the behaviour already has a home. The canonical task model has exactly
   one representation (ADR-001); a new view is a projection, never a second model.

## While writing code

- Put logic at the layer that owns it. Business rules belong in `domain` or
  `application`, never in a route handler or a React component.
- Prefer extending an existing policy to adding a parallel one.
- Match the surrounding code's conventions rather than importing your own.
- Every material mutation writes an activity row and an outbox row in the same
  transaction. This is not optional, and a test must prove the rollback.

## Before opening a pull request

- `pnpm lint && pnpm typecheck && pnpm test` pass.
- Database changes: `pnpm test:integration` passes against a real PostgreSQL 18.
- Contract changes: `pnpm openapi:generate` has been run and the result committed.
- State plainly what you verified and what you did not. An honest "I could not test the
  timezone path because I had no fixture" is far more useful than silence.

## What to escalate rather than decide

- A change that would alter the shape of a persisted event payload.
- Anything that weakens workspace isolation.
- A new dependency, especially one that spans a layer boundary.
- A migration that is not reversible by a forward migration.
