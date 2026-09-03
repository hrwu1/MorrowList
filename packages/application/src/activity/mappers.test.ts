import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "../ports/index.js";

import {
  DESCRIPTION_PREVIEW_LENGTH,
  changesOf,
  toActivityEntryDto,
} from "./mappers.js";

function event(payload: Record<string, unknown>): ActivityEvent {
  return {
    id: "0198f0a0-0000-7000-8000-000000000001",
    workspaceId: "0198f0a0-0000-7000-8000-000000000002",
    aggregateType: "task",
    aggregateId: "0198f0a0-0000-7000-8000-000000000003",
    eventType: "task.updated",
    actorKind: "user",
    actorId: "user-1",
    actorDisplayName: "Alex",
    summary: "Updated task fields",
    payload,
    correlationId: "req_1",
    createdAt: new Date("2026-08-29T09:00:00.000Z"),
  };
}

describe("changesOf", () => {
  it("maps only the user-facing fields, in a fixed order", () => {
    const changes = changesOf({
      taskId: "t",
      changes: {
        rank: { from: "a0", to: "a1" },
        statusId: { from: "s1", to: "s2" },
        priority: { from: "none", to: "high" },
        title: { from: "Old", to: "New" },
        dueDate: { from: null, to: "2026-09-15" },
      },
    });

    expect(changes).toEqual([
      { field: "title", from: "Old", to: "New" },
      { field: "priority", from: "none", to: "high" },
      { field: "dueDate", from: null, to: "2026-09-15" },
    ]);
  });

  it("previews a long description instead of echoing it whole", () => {
    const long = "x".repeat(DESCRIPTION_PREVIEW_LENGTH + 40);
    const [change] = changesOf({
      changes: { descriptionMd: { from: null, to: long } },
    });

    expect(change?.to).toHaveLength(DESCRIPTION_PREVIEW_LENGTH + 1);
    expect(change?.to?.endsWith("…")).toBe(true);
  });

  it("tolerates payloads without a diff or with a malformed one", () => {
    expect(changesOf({})).toEqual([]);
    expect(changesOf({ changes: "nope" })).toEqual([]);
    expect(changesOf({ changes: { title: "not a diff" } })).toEqual([]);
  });
});

describe("toActivityEntryDto", () => {
  it("serialises the timestamp and keeps the safe summary and payload", () => {
    const dto = toActivityEntryDto(
      event({ taskId: "t", changes: { title: { from: "A", to: "B" } } }),
    );

    expect(dto).toMatchObject({
      eventType: "task.updated",
      actorDisplayName: "Alex",
      summary: "Updated task fields",
      createdAt: "2026-08-29T09:00:00.000Z",
      changes: [{ field: "title", from: "A", to: "B" }],
    });
    expect(dto).not.toHaveProperty("correlationId");
  });
});
