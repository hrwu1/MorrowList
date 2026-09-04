import { DAY_MS, type Clock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectService } from "../projects/service.js";
import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { FlowService } from "./service.js";

/** A clock the test moves by hand, so every duration below is exact. */
function manualClock(start: string): Clock & { advance(days: number): void } {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(days) {
      current += days * DAY_MS;
    },
  };
}

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let clock: ReturnType<typeof manualClock>;
let tasks: TaskService;
let projects: ProjectService;
let flow: FlowService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  clock = manualClock("2026-08-03T09:00:00.000Z");
  tasks = new TaskService({ unitOfWork, clock, cursorSecret: "secret" });
  projects = new ProjectService({ unitOfWork, clock });
  flow = new FlowService({ unitOfWork, clock });
});

async function boardTask(title: string, category: "backlog" | "ready" = "ready") {
  return tasks.create(seeded.context, {
    workspaceId: seeded.workspace.id,
    title,
    projectId: seeded.project.id,
    statusId: statusByCategory(seeded.statuses, category).id,
  });
}

async function moveTo(taskId: string, category: "in_progress" | "review" | "done") {
  return tasks.move(seeded.context, seeded.workspace.id, taskId, {
    projectId: seeded.project.id,
    statusId: statusByCategory(seeded.statuses, category).id,
  });
}

describe("FlowService.project", () => {
  it("summarises cycle time, lead time, throughput, WIP and aging from the intervals", async () => {
    const workspaceId = seeded.workspace.id;
    // Task A: Ready → In Progress (day 2) → Done (day 5): cycle 3d, lead 5d.
    const a = await boardTask("A");
    clock.advance(2);
    await moveTo(a.id, "in_progress");
    clock.advance(3);
    await moveTo(a.id, "done");
    // Task B: Ready → Done straight away on day 6: no cycle time, lead 0d.
    clock.advance(1);
    const b = await boardTask("B");
    await tasks.complete(seeded.context, workspaceId, b.id);
    // Task C: started on day 7 and still open on day 10: WIP, aging 3d.
    clock.advance(1);
    const c = await boardTask("C");
    await moveTo(c.id, "in_progress");
    // Task D: queued only: neither WIP nor aging.
    await boardTask("D", "backlog");
    clock.advance(3);

    const summary = await flow.project(seeded.context, workspaceId, seeded.project.id, {
      range: "30",
    });

    expect(summary).toMatchObject({
      range: "30",
      timezone: "Europe/Berlin",
      to: "2026-08-13",
      from: "2026-07-15",
      wip: 1,
      completed: 2,
      cycleTimeDays: { samples: 1, p50: 3, p85: 3, p95: 3 },
      leadTimeDays: { samples: 2, p50: 0, p85: 5, p95: 5 },
    });
    expect(summary.throughput.filter((week) => week.count > 0)).toEqual([
      { weekStart: "2026-08-03", count: 2 },
    ]);
    expect(summary.aging).toEqual([
      expect.objectContaining({
        taskId: c.id,
        key: c.key,
        title: "C",
        category: "in_progress",
        statusName: "In Progress",
        ageDays: 3,
        band: "under_p50",
      }),
    ]);
    const last = summary.cumulativeFlow.at(-1);
    expect(last?.date).toBe("2026-08-13");
    expect(last?.counts).toMatchObject({ backlog: 1, in_progress: 1, done: 2 });
    expect(summary.cumulativeFlow).toHaveLength(30);
  });

  it("counts a reopened task as WIP again and only its latest completion", async () => {
    const workspaceId = seeded.workspace.id;
    const task = await boardTask("Again");
    await moveTo(task.id, "in_progress");
    clock.advance(1);
    await moveTo(task.id, "done");
    clock.advance(1);
    await tasks.reopen(seeded.context, workspaceId, task.id);

    const open = await flow.project(seeded.context, workspaceId, seeded.project.id, {
      range: "30",
    });
    expect(open.wip).toBe(1);
    expect(open.completed).toBe(0);

    clock.advance(4);
    await moveTo(task.id, "done");
    const done = await flow.project(seeded.context, workspaceId, seeded.project.id, {
      range: "30",
    });
    expect(done.completed).toBe(1);
    expect(done.cycleTimeDays).toEqual({ samples: 1, p50: 4, p85: 4, p95: 4 });
  });

  it("is empty for a project without history and hides other projects and archived ones", async () => {
    const other = await projects.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      name: "Other",
    });
    const task = await boardTask("Mine");
    await moveTo(task.id, "in_progress");

    const summary = await flow.project(
      seeded.context,
      seeded.workspace.id,
      other.project.id,
      { range: "90" },
    );
    expect(summary).toMatchObject({
      wip: 0,
      completed: 0,
      cycleTimeDays: { samples: 0, p50: null, p85: null, p95: null },
      aging: [],
    });
    expect(summary.cumulativeFlow).toHaveLength(90);

    await expect(
      flow.project(
        seeded.context,
        seeded.workspace.id,
        "01a04e0f-0000-7000-8000-0000000000ff",
        {
          range: "90",
        },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("attaches inStatusSince and ageDays to board cards only", async () => {
    const task = await boardTask("Card");
    clock.advance(1);
    await moveTo(task.id, "in_progress");
    clock.advance(2);

    const board = await projects.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    const card = board.data.tasks.find((candidate) => candidate.id === task.id);
    expect(card?.inStatusSince).toBe("2026-08-04T09:00:00.000Z");
    expect(card?.ageDays).toBe(2);

    const fetched = await tasks.get(seeded.context, seeded.workspace.id, task.id);
    expect(fetched).not.toHaveProperty("inStatusSince");
  });
});
