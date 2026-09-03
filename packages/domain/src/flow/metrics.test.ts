import { describe, expect, it } from "vitest";

import type { StatusCategory } from "../project/status.js";
import { testContext } from "../task/fixtures.js";
import { createTask } from "../task/policies.js";
import type { Task } from "../task/task.js";
import type { PlainDate } from "../task/values.js";

import {
  DAY_MS,
  ageOf,
  agingWip,
  cumulativeFlow,
  currentRun,
  cycleTime,
  intervalTransition,
  leadTime,
  percentiles,
  startOfWeek,
  throughputByWeek,
  type StatusInterval,
} from "./metrics.js";

/** Intervals from a compact history: `[category, enteredAt]`, each closed by the next. */
function history(
  taskId: string,
  steps: readonly (readonly [StatusCategory, string])[],
  options: { closeLast?: string } = {},
): StatusInterval[] {
  return steps.map(([category, entered], index) => {
    const next = steps[index + 1];
    return {
      taskId,
      statusId: `status-${category}`,
      category,
      enteredAt: new Date(entered),
      leftAt: next
        ? new Date(next[1])
        : options.closeLast
          ? new Date(options.closeLast)
          : null,
    };
  });
}

const days = (n: number) => n * DAY_MS;

function buildTask(overrides: Partial<Task>): Task {
  const task = createTask(
    {
      id: "task-1",
      workspaceId: "workspace-1",
      taskNumber: 1,
      title: "A task",
      rank: "a0",
    },
    testContext(),
  );
  return { ...task, ...overrides };
}

describe("cycleTime and leadTime", () => {
  it("measures from the In Progress entry to the Done entry, ignoring Backlog time", () => {
    const intervals = history("t1", [
      ["backlog", "2026-08-01T09:00:00Z"],
      ["ready", "2026-08-10T09:00:00Z"],
      ["in_progress", "2026-08-12T09:00:00Z"],
      ["review", "2026-08-14T09:00:00Z"],
      ["done", "2026-08-15T09:00:00Z"],
    ]);

    expect(cycleTime(intervals)).toBe(days(3));
    expect(leadTime(intervals)).toBe(days(14));
  });

  it("is null for open work and for work finished without ever starting", () => {
    expect(
      cycleTime(history("t1", [["in_progress", "2026-08-12T09:00:00Z"]])),
    ).toBeNull();
    const skipped = history("t2", [
      ["ready", "2026-08-10T09:00:00Z"],
      ["done", "2026-08-11T09:00:00Z"],
    ]);
    expect(cycleTime(skipped)).toBeNull();
    expect(leadTime(skipped)).toBe(days(1));
  });

  it("does not count a Done interval that was left (trashed or moved to the Inbox)", () => {
    const intervals = history(
      "t1",
      [
        ["in_progress", "2026-08-12T09:00:00Z"],
        ["done", "2026-08-13T09:00:00Z"],
      ],
      { closeLast: "2026-08-14T09:00:00Z" },
    );
    expect(cycleTime(intervals)).toBeNull();
    expect(leadTime(intervals)).toBeNull();
  });

  it("starts over after a reopen while keeping the earlier intervals", () => {
    const intervals = history("t1", [
      ["in_progress", "2026-08-01T09:00:00Z"],
      ["done", "2026-08-03T09:00:00Z"],
      ["ready", "2026-08-10T09:00:00Z"],
      ["in_progress", "2026-08-11T09:00:00Z"],
      ["done", "2026-08-16T09:00:00Z"],
    ]);

    expect(currentRun(intervals)).toHaveLength(3);
    expect(cycleTime(intervals)).toBe(days(5));
    expect(leadTime(intervals)).toBe(days(6));
  });

  it("uses the first In Progress entry across several passes and the first Done entry", () => {
    const intervals = history("t1", [
      ["in_progress", "2026-08-01T09:00:00Z"],
      ["blocked", "2026-08-02T09:00:00Z"],
      ["in_progress", "2026-08-05T09:00:00Z"],
      ["ready", "2026-08-06T09:00:00Z"],
      ["in_progress", "2026-08-08T09:00:00Z"],
      ["done", "2026-08-09T09:00:00Z"],
      ["done", "2026-08-12T09:00:00Z"],
    ]);
    expect(cycleTime(intervals)).toBe(days(8));
  });

  it("orders intervals by time regardless of input order and breaks ties by openness", () => {
    const shuffled = [
      ...history("t1", [
        ["ready", "2026-08-10T09:00:00Z"],
        ["in_progress", "2026-08-12T09:00:00Z"],
        ["done", "2026-08-15T09:00:00Z"],
      ]),
    ].reverse();
    expect(cycleTime(shuffled)).toBe(days(3));

    // Closed and opened at the same instant: the open one is the current status.
    const tie: StatusInterval[] = [
      {
        taskId: "t2",
        statusId: "s-progress",
        category: "in_progress",
        enteredAt: new Date("2026-08-12T09:00:00Z"),
        leftAt: null,
      },
      {
        taskId: "t2",
        statusId: "s-ready",
        category: "ready",
        enteredAt: new Date("2026-08-12T09:00:00Z"),
        leftAt: new Date("2026-08-12T09:00:00Z"),
      },
    ];
    expect(ageOf(tie, new Date("2026-08-13T09:00:00Z"))).toBe(days(1));
  });
});

describe("ageOf", () => {
  it("is the time since the item started, and null while queued or done", () => {
    const now = new Date("2026-08-20T09:00:00Z");
    const started = history("t1", [
      ["ready", "2026-08-10T09:00:00Z"],
      ["in_progress", "2026-08-12T09:00:00Z"],
      ["review", "2026-08-18T09:00:00Z"],
    ]);
    expect(ageOf(started, now)).toBe(days(8));
    expect(ageOf(history("t2", [["ready", "2026-08-10T09:00:00Z"]]), now)).toBeNull();
    expect(
      ageOf(
        history("t3", [
          ["in_progress", "2026-08-10T09:00:00Z"],
          ["done", "2026-08-11T09:00:00Z"],
        ]),
        now,
      ),
    ).toBeNull();
  });
});

describe("percentiles", () => {
  it("uses the nearest rank so every percentile is a sample", () => {
    const result = percentiles([5, 1, 4, 2, 3]);
    expect(result.get(50)).toBe(3);
    expect(result.get(85)).toBe(5);
    expect(result.get(95)).toBe(5);
  });

  it("handles ties and a single sample, and is empty for no samples", () => {
    expect([...percentiles([2, 2, 2, 9]).values()]).toEqual([2, 9, 9]);
    expect([...percentiles([7]).values()]).toEqual([7, 7, 7]);
    expect(percentiles([]).size).toBe(0);
  });
});

describe("throughputByWeek", () => {
  it("buckets completions into Monday-start weeks in the workspace timezone", () => {
    const range = { from: "2026-08-03" as PlainDate, to: "2026-08-23" as PlainDate };
    const weeks = throughputByWeek(
      [
        // 22:30 UTC on Sunday is already Monday 24 August in Berlin: outside the range.
        new Date("2026-08-23T22:30:00Z"),
        new Date("2026-08-04T10:00:00Z"),
        new Date("2026-08-09T10:00:00Z"),
        new Date("2026-08-20T10:00:00Z"),
        new Date("2026-08-01T10:00:00Z"),
      ],
      range,
      "Europe/Berlin",
    );

    expect(weeks).toEqual([
      { weekStart: "2026-08-03", count: 2 },
      { weekStart: "2026-08-10", count: 0 },
      { weekStart: "2026-08-17", count: 1 },
    ]);
  });

  it("starts the first bucket on the Monday before a mid-week range start", () => {
    expect(startOfWeek("2026-08-05" as PlainDate)).toBe("2026-08-03");
    expect(startOfWeek("2026-08-03" as PlainDate)).toBe("2026-08-03");
    expect(startOfWeek("2026-08-09" as PlainDate)).toBe("2026-08-03");
  });
});

describe("cumulativeFlow", () => {
  it("counts each task in exactly one category per day", () => {
    const range = { from: "2026-08-01" as PlainDate, to: "2026-08-05" as PlainDate };
    const intervals = [
      ...history("t1", [
        ["ready", "2026-07-20T09:00:00Z"],
        ["in_progress", "2026-08-02T09:00:00Z"],
        ["done", "2026-08-04T09:00:00Z"],
      ]),
      // Entered and left Ready on the same day, then In Progress: never counted as Ready.
      ...history("t2", [
        ["ready", "2026-08-03T08:00:00Z"],
        ["in_progress", "2026-08-03T10:00:00Z"],
      ]),
      // Left the board (trashed) on the 5th: absent from that day onwards.
      ...history("t3", [["backlog", "2026-08-01T09:00:00Z"]], {
        closeLast: "2026-08-05T09:00:00Z",
      }),
    ];

    const flow = cumulativeFlow(intervals, range, "UTC");
    const pick = (date: string) => flow.find((day) => day.date === date)?.counts;

    expect(flow.map((day) => day.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(pick("2026-08-01")).toMatchObject({ ready: 1, backlog: 1, in_progress: 0 });
    expect(pick("2026-08-02")).toMatchObject({ ready: 0, in_progress: 1, backlog: 1 });
    expect(pick("2026-08-03")).toMatchObject({ ready: 0, in_progress: 2, backlog: 1 });
    expect(pick("2026-08-04")).toMatchObject({ in_progress: 1, done: 1, backlog: 1 });
    expect(pick("2026-08-05")).toMatchObject({ in_progress: 1, done: 1, backlog: 0 });
    for (const day of flow) {
      expect(
        Object.values(day.counts).reduce((sum, n) => sum + n, 0),
      ).toBeLessThanOrEqual(3);
    }
  });
});

describe("agingWip", () => {
  it("lists started open items oldest first with the percentile band they crossed", () => {
    const now = new Date("2026-08-20T09:00:00Z");
    const intervals = [
      ...history("old", [["in_progress", "2026-08-01T09:00:00Z"]]),
      ...history("fresh", [["review", "2026-08-19T09:00:00Z"]]),
      ...history("queued", [["ready", "2026-08-01T09:00:00Z"]]),
      ...history("finished", [
        ["in_progress", "2026-08-01T09:00:00Z"],
        ["done", "2026-08-02T09:00:00Z"],
      ]),
    ];
    const reference = new Map([
      [50, days(2)],
      [85, days(5)],
      [95, days(10)],
    ]);

    expect(agingWip(intervals, now, reference)).toEqual([
      {
        taskId: "old",
        statusId: "status-in_progress",
        category: "in_progress",
        age: days(19),
        band: "over_p95",
      },
      {
        taskId: "fresh",
        statusId: "status-review",
        category: "review",
        age: days(1),
        band: "under_p50",
      },
    ]);
    expect(agingWip(intervals, now, new Map())[0]?.band).toBeNull();
  });
});

describe("intervalTransition", () => {
  const project = { projectId: "p1", statusId: "s-ready" };
  const onBoard = buildTask({ projectId: "p1", statusId: "s-ready" });

  it("opens on placement, closes and reopens on a status change, closes on trash", () => {
    const inbox = buildTask({ projectId: null, statusId: null });
    expect(intervalTransition(inbox, onBoard)).toEqual({
      closes: false,
      opens: project,
    });
    expect(intervalTransition(onBoard, { ...onBoard, statusId: "s-progress" })).toEqual(
      { closes: true, opens: { projectId: "p1", statusId: "s-progress" } },
    );
    expect(intervalTransition(onBoard, { ...onBoard, deletedAt: new Date() })).toEqual({
      closes: true,
      opens: null,
    });
    expect(intervalTransition(onBoard, inbox)).toEqual({ closes: true, opens: null });
  });

  it("ignores changes that keep the task where it is", () => {
    expect(intervalTransition(onBoard, { ...onBoard, title: "Renamed" })).toEqual({
      closes: false,
      opens: null,
    });
    const inbox = buildTask({ projectId: null, statusId: null });
    expect(intervalTransition(inbox, { ...inbox, deletedAt: new Date() })).toEqual({
      closes: false,
      opens: null,
    });
  });
});
