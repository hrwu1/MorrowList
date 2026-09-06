# ADR-017: Swimlanes pivot a board; across projects its columns are categories

**Status:** Proposed

**Date:** 2026-09-05

## Decision

**Decision:** A board keeps workflow status as its only column axis (ADR-002) and gains a
second, orthogonal axis: a swimlane, chosen from priority, project, tag, due bucket or
parent. Lanes and each card's cell are computed on the server and returned with the
board — `lanes[]` plus a `placements[]` entry of `{taskId, columnKey, laneKey}` beside the
existing flat `tasks[]` — never derived in the browser and never stored on the task.

A board may span projects. Because a workflow status name belongs to its project
(spec 11.3), a board that spans projects columns by *semantic category* instead:
`columnsBy: "category"` with the six categories every workflow shares. Dropping a card
into a category column resolves that category inside the card's own project by spec 11.5 —
the lowest-ranked active status of that category, else the project's default — through the
existing `TaskService.move`, which now accepts `statusCategory` instead of `statusId`.

A lane is *writable* when dropping a card into it is an ordinary mutation of the card:
priority, project and tag lanes are; due and parent lanes are not.

## Reasoning

- Group-by is the single most common board request in the competitor analysis, and every
  tool that has it treats a lane as a filtered row, not a container. Making the lane a
  container would give a task two homes and contradict ADR-001.
- Deriving lanes in the browser would put a business rule — "which lane is this card in" —
  in a React component, which `docs/contributing/agents.md` forbids and which no test at
  the right layer could cover. The server already loads every field a lane keys on.
- Categories are the only column vocabulary two projects share. Aligning by name would
  merge a "Doing" with a "Doing" and split it from an "Active" that means the same thing;
  aligning by id is impossible across projects.
- Naming the move destination by category, rather than adding a resolve-then-move round
  trip, keeps the resolution inside the transaction that performs the move, so a status
  archived between the two steps cannot strand a card.
- Due dates and parents are not things to infer from where a card was dropped. Making
  those lanes read-only, and saying so on the lane, is more honest than guessing a date.

## Consequences

- No schema change: the board still projects the one task model.
- `GET /views/board` renders any saved view's filters, or Today, as a board. Today reads
  the same `listToday` projection as `/views/today`, so My Day selections appear; a card
  completed there leaves the board, exactly as it leaves the Today list.
- A card with no project has no workflow status. On a category board it sits in Backlog,
  or Done when completed, and the only column drops offered are complete and reopen.
- A drop that crosses a column and a lane at once is two commands, applied in order, each
  recording its own activity and outbox rows. There is no combined event.
- Ranks stay scoped to a project status (ADR-009), so a board spanning projects never
  rewrites them: a card lands at the end of its destination scope. Switching the pivot
  changes no rank at all.
- `swimlaneBy` and the collapsed lanes are view state: the pivot lives in the URL, the
  collapsed lanes in `localStorage`, like collapsed columns.
