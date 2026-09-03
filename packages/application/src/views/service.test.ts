import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { ViewService } from "./service.js";

/** 2026-09-03 is 01:30 on 4 September in Auckland, but still 3 September in Berlin. */
const NOW = new Date("2026-09-03T13:30:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let tasks: TaskService;
let views: ViewService;
let seeded: SeededWorkspace;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  const clock = fixedClock(NOW);
  tasks = new TaskService({ unitOfWork, clock, cursorSecret: "secret" });
  views = new ViewService({ unitOfWork, clock });
});

async function create(title: string, fields: Record<string, unknown> = {}) {
  return tasks.create(seeded.context, {
    workspaceId: seeded.workspace.id,
    title,
    ...fields,
  });
}

function ids(section: { tasks: readonly { task: { id: string } }[] } | undefined) {
  return section?.tasks.map((entry) => entry.task.id) ?? [];
}

describe("ViewService.today", () => {
  it("unions overdue, due-today, and My Day tasks once each, in precedence order", async () => {
    const overduePlanned = await create("Overdue and planned", {
      dueDate: "2026-09-01",
    });
    const dueToday = await create("Due today", { dueDate: "2026-09-03" });
    const planned = await create("Planned", { addToDay: "2026-09-03" });
    await create("Future", { dueDate: "2026-09-04" });
    await create("Unplanned");
    const done = await create("Done", { dueDate: "2026-09-03" });
    await tasks.addToDay(seeded.context, seeded.workspace.id, overduePlanned.id);
    await tasks.complete(seeded.context, seeded.workspace.id, done.id);

    const { data } = await views.today(seeded.context, {
      workspaceId: seeded.workspace.id,
    });

    expect(data.date).toBe("2026-09-03");
    expect(data.sections.map((section) => section.id)).toEqual([
      "overdue",
      "due_today",
      "my_day",
    ]);
    expect(ids(data.sections[0])).toEqual([overduePlanned.id]);
    expect(data.sections[0]?.tasks[0]?.reasons).toEqual(["overdue", "my_day"]);
    expect(data.sections[0]?.tasks[0]?.task.dayPlans).toEqual(["2026-09-03"]);
    expect(ids(data.sections[1])).toEqual([dueToday.id]);
    expect(ids(data.sections[2])).toEqual([planned.id]);
    expect(data.review).toBeNull();
  });

  it("evaluates today in the workspace timezone", async () => {
    const auckland = seedWorkspace(unitOfWork.data, {
      workspace: { timezone: "Pacific/Auckland", slug: "nz", taskKeyPrefix: "NZ" },
    });
    const service = new TaskService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "secret",
    });
    const dueFourth = await service.create(auckland.context, {
      workspaceId: auckland.workspace.id,
      title: "Due on the fourth",
      dueDate: "2026-09-04",
    });

    const { data } = await views.today(auckland.context, {
      workspaceId: auckland.workspace.id,
    });

    expect(data.date).toBe("2026-09-04");
    expect(ids(data.sections[1])).toEqual([dueFourth.id]);
  });

  it("shows yesterday's unfinished manual selections only in the review", async () => {
    // Completion criterion: nothing rolls forward silently (spec 9.2).
    const stale = await create("Chosen yesterday");
    const finished = await create("Finished yesterday");
    const reAdded = await create("Chosen again");
    const captured = await create("Captured yesterday", { addToDay: "2026-09-02" });
    for (const task of [stale, finished, reAdded]) {
      await tasks.addToDay(seeded.context, seeded.workspace.id, task.id, {
        date: "2026-09-02",
      });
    }
    await tasks.complete(seeded.context, seeded.workspace.id, finished.id);
    await tasks.addToDay(seeded.context, seeded.workspace.id, reAdded.id);

    const { data } = await views.today(seeded.context, {
      workspaceId: seeded.workspace.id,
    });

    expect(data.review).toEqual({
      date: "2026-09-02",
      tasks: [expect.objectContaining({ id: stale.id, dayPlans: [] })],
    });
    expect(data.sections.flatMap(ids)).toEqual([reAdded.id]);
    expect(data.sections.flatMap(ids)).not.toContain(captured.id);
  });

  it("opens a past day without a review, showing that day's selections", async () => {
    const chosen = await create("Chosen yesterday");
    await tasks.addToDay(seeded.context, seeded.workspace.id, chosen.id, {
      date: "2026-09-02",
    });

    const { data } = await views.today(seeded.context, {
      workspaceId: seeded.workspace.id,
      date: "2026-09-02",
    });

    expect(data.date).toBe("2026-09-02");
    expect(ids(data.sections[2])).toEqual([chosen.id]);
    expect(data.review).toBeNull();
  });

  it("carries each task's subtask progress like the list does", async () => {
    const parent = await create("Parent", { dueDate: "2026-09-03" });
    const child = await create("Child", { parentTaskId: parent.id });
    await create("Other child", { parentTaskId: parent.id });
    await tasks.complete(seeded.context, seeded.workspace.id, child.id);

    const { data } = await views.today(seeded.context, {
      workspaceId: seeded.workspace.id,
    });

    expect(data.sections[1]?.tasks[0]?.task.subtaskProgress).toEqual({
      completed: 1,
      total: 2,
    });
  });

  it("refuses another workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);

    await expect(
      views.today(seeded.context, { workspaceId: other.workspace.id }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
});

describe("ViewService.upcoming", () => {
  beforeEach(async () => {
    await create("Today", { dueDate: "2026-09-03" });
    await create("Tomorrow", { dueDate: "2026-09-04" });
    await create("Next week", { dueDate: "2026-09-10" });
    await create("In two weeks", { dueDate: "2026-09-17" });
    await create("Next month", { dueDate: "2026-10-05" });
    await create("Undated");
  });

  it("groups future tasks by date within the default two-week horizon", async () => {
    const { data } = await views.upcoming(seeded.context, {
      workspaceId: seeded.workspace.id,
      horizon: "14",
    });

    expect(data.from).toBe("2026-09-03");
    expect(data.groups.map((group) => group.date)).toEqual([
      "2026-09-04",
      "2026-09-10",
      "2026-09-17",
    ]);
    expect(data.truncated).toBe(false);
  });

  it("honours the other horizons", async () => {
    const week = await views.upcoming(seeded.context, {
      workspaceId: seeded.workspace.id,
      horizon: "7",
    });
    const all = await views.upcoming(seeded.context, {
      workspaceId: seeded.workspace.id,
      horizon: "all",
    });

    // A horizon is inclusive: seven days from the third reaches the tenth.
    expect(week.data.groups.map((group) => group.date)).toEqual([
      "2026-09-04",
      "2026-09-10",
    ]);
    expect(all.data.groups.map((group) => group.date)).toEqual([
      "2026-09-04",
      "2026-09-10",
      "2026-09-17",
      "2026-10-05",
    ]);
  });

  it("carries each task's subtask progress like the list does", async () => {
    const parent = await create("Parent", { dueDate: "2026-09-05" });
    const child = await create("Child", { parentTaskId: parent.id });
    await tasks.complete(seeded.context, seeded.workspace.id, child.id);

    const { data } = await views.upcoming(seeded.context, {
      workspaceId: seeded.workspace.id,
      horizon: "14",
    });

    const group = data.groups.find((candidate) => candidate.date === "2026-09-05");
    expect(group?.tasks.map((task) => task.subtaskProgress)).toEqual([
      { completed: 1, total: 1 },
    ]);
  });

  it("starts from an explicit date", async () => {
    const { data } = await views.upcoming(seeded.context, {
      workspaceId: seeded.workspace.id,
      from: "2026-09-10",
      horizon: "30",
    });

    expect(data.groups.map((group) => group.date)).toEqual([
      "2026-09-17",
      "2026-10-05",
    ]);
  });
});
