import type { TaskDto, UpcomingViewResponse } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { formatGroupDate, patchTaskInUpcoming, readHorizon } from "./upcoming-view";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "0198f0a0-0000-7000-8000-000000000001",
    key: "ML-1",
    workspaceId: "0198f0a0-0000-7000-8000-000000000010",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: "Task",
    descriptionMd: null,
    priority: "none",
    dueDate: "2026-09-04",
    dueTime: null,
    dueTimezone: null,
    parentTaskId: null,
    rank: "a0",
    isCompleted: false,
    completedAt: null,
    version: 1,
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-09-03T09:00:00.000Z",
    updatedAt: "2026-09-03T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    tags: [],
    subtaskProgress: null,
    ...overrides,
  };
}

function view(groups: UpcomingViewResponse["data"]["groups"]): UpcomingViewResponse {
  return { data: { from: "2026-09-03", horizon: "14", groups, truncated: false } };
}

describe("readHorizon", () => {
  it("defaults to fourteen days and ignores unknown values", () => {
    expect(readHorizon(new URLSearchParams())).toBe("14");
    expect(readHorizon(new URLSearchParams("horizon=all"))).toBe("all");
    expect(readHorizon(new URLSearchParams("horizon=9"))).toBe("14");
  });
});

describe("formatGroupDate", () => {
  it("names tomorrow and keeps the year off nearby dates", () => {
    expect(formatGroupDate("2026-09-04", "2026-09-03")).toBe("Tomorrow");
    expect(formatGroupDate("2026-09-08", "2026-09-03")).not.toContain("2026");
    expect(formatGroupDate("2026-09-17", "2026-09-03")).toContain("2026");
  });
});

describe("patchTaskInUpcoming", () => {
  it("moves a rescheduled task to its new date group, creating it in order", () => {
    const soon = task();
    const cached = view([
      { date: "2026-09-04", tasks: [soon] },
      {
        date: "2026-09-10",
        tasks: [task({ id: "2", key: "ML-2", dueDate: "2026-09-10" })],
      },
    ]);

    const patched = patchTaskInUpcoming(cached, { ...soon, dueDate: "2026-09-08" });

    expect(patched.data.groups.map((group) => group.date)).toEqual([
      "2026-09-08",
      "2026-09-10",
    ]);
    expect(patched.data.groups[0]?.tasks[0]?.id).toBe(soon.id);
  });

  it("drops a task that was completed, cleared, or moved outside the horizon", () => {
    const soon = task();
    const cached = view([{ date: "2026-09-04", tasks: [soon] }]);

    expect(
      patchTaskInUpcoming(cached, { ...soon, isCompleted: true }).data.groups,
    ).toEqual([]);
    expect(patchTaskInUpcoming(cached, { ...soon, dueDate: null }).data.groups).toEqual(
      [],
    );
    expect(
      patchTaskInUpcoming(cached, { ...soon, dueDate: "2026-09-18" }).data.groups,
    ).toEqual([]);
    expect(
      patchTaskInUpcoming(cached, { ...soon, dueDate: "2026-09-03" }).data.groups,
    ).toEqual([]);
  });

  it("keeps everything when the horizon is open", () => {
    const soon = task();
    const cached: UpcomingViewResponse = {
      data: { from: "2026-09-03", horizon: "all", groups: [], truncated: false },
    };

    const patched = patchTaskInUpcoming(cached, { ...soon, dueDate: "2027-01-01" });

    expect(patched.data.groups).toEqual([
      { date: "2027-01-01", tasks: [{ ...soon, dueDate: "2027-01-01" }] },
    ]);
  });
});
