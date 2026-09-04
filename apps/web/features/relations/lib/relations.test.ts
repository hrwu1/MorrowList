import type { TaskDto, TaskRelationDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  blockedBy,
  blockedSummary,
  blocks,
  openBlockers,
  relatedTo,
  withBlockedFlag,
  withoutBlockedFlag,
} from "./relations";

const ME = "01a04e0f-0000-7000-8000-000000000001";
const OTHER = "01a04e0f-0000-7000-8000-000000000002";
const THIRD = "01a04e0f-0000-7000-8000-000000000003";

function relation(overrides: Partial<TaskRelationDto>): TaskRelationDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000010",
    type: "blocks",
    sourceTaskId: OTHER,
    targetTaskId: ME,
    task: { id: OTHER, key: "ML-2", title: "Collect sources", isCompleted: false },
    createdAt: "2026-09-03T09:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: ME,
    key: "ML-1",
    workspaceId: "01a04e0f-0000-7000-8000-000000000009",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: "Make slides",
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    parentTaskId: null,
    rank: "a0",
    isCompleted: false,
    completedAt: null,
    version: 1,
    tags: [],
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-09-03T09:00:00.000Z",
    updatedAt: "2026-09-03T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    relations: [],
    blocked: null,
    isBlocked: false,
    ...overrides,
  };
}

const incoming = relation({});
const outgoing = relation({
  id: "01a04e0f-0000-7000-8000-000000000011",
  sourceTaskId: ME,
  targetTaskId: THIRD,
  task: { id: THIRD, key: "ML-3", title: "Present", isCompleted: false },
});
const related = relation({
  id: "01a04e0f-0000-7000-8000-000000000012",
  type: "related_to",
  sourceTaskId: ME,
  targetTaskId: THIRD,
  task: { id: THIRD, key: "ML-3", title: "Present", isCompleted: true },
});

describe("relation directions", () => {
  it("splits a task's relations by direction from its own point of view", () => {
    const subject = task({ relations: [incoming, outgoing, related] });
    expect(blockedBy(subject).map((r) => r.task.key)).toEqual(["ML-2"]);
    expect(blocks(subject).map((r) => r.task.key)).toEqual(["ML-3"]);
    expect(relatedTo(subject).map((r) => r.task.key)).toEqual(["ML-3"]);
  });

  it("counts only open predecessors as blockers", () => {
    const done = relation({ task: { ...incoming.task, isCompleted: true } });
    expect(openBlockers(task({ relations: [done] }))).toEqual([]);
    expect(openBlockers(task({ relations: [incoming] }))).toHaveLength(1);
  });
});

describe("blockedSummary", () => {
  it("names the reason and the open predecessors, or nothing", () => {
    expect(blockedSummary(task())).toBeNull();
    expect(
      blockedSummary(
        task({
          isBlocked: true,
          blocked: { reason: "waiting on vendor", since: "2026-09-03T09:00:00.000Z" },
          relations: [incoming],
        }),
      ),
    ).toBe("waiting on vendor · Waiting on ML-2 Collect sources");
    expect(blockedSummary(task({ isBlocked: true, relations: [incoming] }))).toBe(
      "Waiting on ML-2 Collect sources",
    );
  });
});

describe("optimistic flag shapes", () => {
  it("flags with the first start time and clears back to the predecessor state", () => {
    const flagged = withBlockedFlag(task(), "vendor", "2026-09-03T10:00:00.000Z");
    expect(flagged.isBlocked).toBe(true);
    expect(flagged.blocked?.since).toBe("2026-09-03T10:00:00.000Z");
    const reworded = withBlockedFlag(flagged, "legal", "2026-09-04T10:00:00.000Z");
    expect(reworded.blocked).toEqual({
      reason: "legal",
      since: "2026-09-03T10:00:00.000Z",
    });

    expect(withoutBlockedFlag(flagged).isBlocked).toBe(false);
    expect(withoutBlockedFlag({ ...flagged, relations: [incoming] }).isBlocked).toBe(
      true,
    );
    expect(withBlockedFlag(task({ isCompleted: true }), "x", "now").isBlocked).toBe(
      false,
    );
  });
});
