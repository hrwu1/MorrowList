import type { TaskDto } from "@morrowlist/contracts";
import type { PlainDate } from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import type { Project } from "../ports/index.js";
import { buildProject } from "../testing/factories.js";

import { ALL_LANE_KEY, buildLanes, laneKeyFor } from "./lanes.js";

const TODAY = "2026-09-05" as PlainDate;
const WORKSPACE = "0198f0a0-0000-7000-8000-0000000000ff";

const BASE: TaskDto = {
  id: "0198f0a0-0000-7000-8000-000000000001",
  key: "ML-000001",
  workspaceId: WORKSPACE,
  taskNumber: 1,
  projectId: null,
  statusId: null,
  title: "A card",
  descriptionMd: null,
  priority: "none",
  dueDate: null,
  dueTime: null,
  dueTimezone: null,
  deferUntil: null,
  deadline: null,
  deadlineTime: null,
  dateWarnings: [],
  reminderOffsetMinutes: null,
  parentTaskId: null,
  recurrence: null,
  seriesId: null,
  rank: "a0",
  isCompleted: false,
  completedAt: null,
  version: 1,
  tags: [],
  createdBy: { kind: "user", id: "user-1" },
  lastActor: { kind: "user", id: "user-1" },
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
  deletedAt: null,
  dayPlans: [],
  subtaskProgress: null,
  relations: [],
  blocked: null,
  isBlocked: false,
};

const card = (id: string, overrides: Partial<TaskDto> = {}): TaskDto => ({
  ...BASE,
  id,
  ...overrides,
});

const tag = (id: string, name: string, colorToken = "blue") => ({
  id,
  workspaceId: WORKSPACE,
  name,
  colorToken,
  description: null,
  createdAt: BASE.createdAt,
  updatedAt: BASE.updatedAt,
});

const context = (
  projects: readonly Project[] = [],
  parents: [string, string][] = [],
) => ({
  projects,
  parentTitles: new Map(parents),
  today: TODAY,
});

describe("buildLanes", () => {
  it("reports one unnamed lane when the board has no swimlane", () => {
    const cards = [card("t-1"), card("t-2")];

    const { lanes, laneKeys } = buildLanes("none", cards, context());

    expect(lanes).toEqual([
      {
        key: ALL_LANE_KEY,
        label: "All cards",
        value: null,
        writable: false,
        colorToken: null,
        count: 2,
      },
    ]);
    expect([...laneKeys.values()]).toEqual([ALL_LANE_KEY, ALL_LANE_KEY]);
  });

  it("offers every priority lane, urgent first, even when empty", () => {
    const cards = [card("t-1", { priority: "high" }), card("t-2")];

    const { lanes, laneKeys } = buildLanes("priority", cards, context());

    expect(lanes.map((lane) => lane.key)).toEqual([
      "priority:urgent",
      "priority:high",
      "priority:medium",
      "priority:low",
      "priority:none",
    ]);
    expect(lanes.every((lane) => lane.writable)).toBe(true);
    expect(lanes.map((lane) => lane.count)).toEqual([0, 1, 0, 0, 1]);
    expect(laneKeys.get("t-1")).toBe("priority:high");
    expect(laneKeys.get("t-2")).toBe("priority:none");
  });

  it("puts the Inbox first and then every active project by name", () => {
    const alpha = buildProject(WORKSPACE, { name: "Alpha", colorToken: "green" });
    const zulu = buildProject(WORKSPACE, { name: "Zulu" });
    const cards = [card("t-1", { projectId: zulu.id }), card("t-2")];

    const { lanes, laneKeys } = buildLanes("project", cards, context([zulu, alpha]));

    expect(lanes.map((lane) => lane.label)).toEqual(["Inbox", "Alpha", "Zulu"]);
    expect(lanes.map((lane) => lane.writable)).toEqual([true, true, true]);
    expect(lanes[1]?.colorToken).toBe("green");
    expect(laneKeys.get("t-1")).toBe(`project:${zulu.id}`);
    expect(laneKeys.get("t-2")).toBe("project:none");
  });

  it("lanes a card under its first tag and keeps the untagged lane read-only", () => {
    const design = tag("tag-design", "design", "violet");
    const urgent = tag("tag-urgent", "Urgent");
    const cards = [
      card("t-1", { tags: [design, urgent] }),
      card("t-2", { tags: [urgent] }),
      card("t-3"),
    ];

    const { lanes, laneKeys } = buildLanes("tag", cards, context());

    expect(lanes.map((lane) => lane.label)).toEqual(["design", "Urgent", "No tag"]);
    expect(lanes.map((lane) => lane.writable)).toEqual([true, true, false]);
    expect(laneKeys.get("t-1")).toBe("tag:tag-design");
    expect(laneKeys.get("t-2")).toBe("tag:tag-urgent");
    expect(laneKeys.get("t-3")).toBe("tag:none");
  });

  it("buckets due dates and never offers a due lane as a drop target", () => {
    const cards = [
      card("t-1", { dueDate: "2026-09-01" }),
      card("t-2", { dueDate: TODAY }),
      card("t-3", { dueDate: "2026-09-10" }),
      card("t-4", { dueDate: "2026-12-01" }),
      card("t-5"),
    ];

    const { lanes, laneKeys } = buildLanes("due", cards, context());

    expect(lanes.map((lane) => lane.key)).toEqual([
      "due:overdue",
      "due:today",
      "due:soon",
      "due:later",
      "due:none",
    ]);
    expect(lanes.some((lane) => lane.writable)).toBe(false);
    expect(laneKeys.get("t-3")).toBe("due:soon");
    expect(laneKeys.get("t-4")).toBe("due:later");
  });

  it("drops empty lanes for the read-only pivots", () => {
    const { lanes } = buildLanes("due", [card("t-1", { dueDate: TODAY })], context());

    expect(lanes.map((lane) => lane.key)).toEqual(["due:today"]);
  });

  it("names parent lanes and puts loose cards in their own lane", () => {
    const cards = [
      card("t-1", { parentTaskId: "parent-b" }),
      card("t-2", { parentTaskId: "parent-a" }),
      card("t-3"),
    ];

    const { lanes, laneKeys } = buildLanes(
      "parent",
      cards,
      context(
        [],
        [
          ["parent-a", "Adopt the plan"],
          ["parent-b", "Zip the archive"],
        ],
      ),
    );

    expect(lanes.map((lane) => lane.label)).toEqual([
      "Adopt the plan",
      "Zip the archive",
      "No parent",
    ]);
    expect(lanes.some((lane) => lane.writable)).toBe(false);
    expect(laneKeys.get("t-1")).toBe("parent:parent-b");
    expect(laneKeys.get("t-3")).toBe("parent:none");
  });

  it("builds the same lane key the client will address a drop target by", () => {
    expect(laneKeyFor("none", "anything")).toBe(ALL_LANE_KEY);
    expect(laneKeyFor("priority", "high")).toBe("priority:high");
    expect(laneKeyFor("tag", null)).toBe("tag:none");
  });
});
