import { fixedClock, rankBetween, uuidv7, type Task } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { SCOPES, type ActorContext } from "../shared/actor-context.js";
import { TagService } from "../tags/service.js";
import { TaskService } from "../tasks/service.js";
import {
  buildActorContext,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { ProjectService } from "./service.js";

const NOW = new Date("2026-08-30T12:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let service: ProjectService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  service = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
});

describe("ProjectService.create", () => {
  it("creates a project and its six ordered default statuses atomically", async () => {
    const detail = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      name: "Research Launch",
      descriptionMd: "  Launch plan  ",
      colorToken: "violet",
      icon: "  telescope  ",
    });

    expect(detail.project).toMatchObject({
      name: "Research Launch",
      slug: "research-launch",
      descriptionMd: "Launch plan",
      colorToken: "violet",
      icon: "telescope",
      version: 1,
    });
    expect(detail.statuses.map((status) => status.name)).toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "Blocked",
      "In Review",
      "Done",
    ]);
    expect(detail.statuses.map((status) => status.rank)).toEqual(
      [...detail.statuses.map((status) => status.rank)].sort(),
    );
    expect(detail.statuses.filter((status) => status.isDefault)).toHaveLength(1);
    expect(detail.statuses.find((status) => status.isDefault)?.category).toBe("ready");
    expect(detail.statuses.find((status) => status.isTerminal)?.category).toBe("done");

    const event = unitOfWork.data.activity.at(-1);
    expect(event).toMatchObject({
      aggregateType: "project",
      aggregateId: detail.project.id,
      eventType: "project.created",
    });
    expect(unitOfWork.data.outbox.at(-1)?.eventType).toBe("project.created");
  });

  it("rolls back the project, statuses, activity, and outbox together", async () => {
    const before = {
      projects: unitOfWork.data.projects.size,
      statuses: unitOfWork.data.statuses.size,
      activity: unitOfWork.data.activity.length,
      outbox: unitOfWork.data.outbox.length,
    };
    unitOfWork.failNextCommit();

    await expect(
      service.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        name: "Rolled Back",
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.projects.size).toBe(before.projects);
    expect(unitOfWork.data.statuses.size).toBe(before.statuses);
    expect(unitOfWork.data.activity).toHaveLength(before.activity);
    expect(unitOfWork.data.outbox).toHaveLength(before.outbox);
  });

  it("rejects a duplicate project name case-insensitively", async () => {
    await expect(
      service.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        name: "  TEST PROJECT  ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("ProjectService reads", () => {
  it("lists active projects and returns ordered statuses from detail", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      name: "Alpha",
    });

    const list = await service.list(seeded.context, {
      workspaceId: seeded.workspace.id,
    });
    expect(list.data.map((project) => project.name)).toEqual(["Alpha", "Test Project"]);
    expect(list.page).toEqual({ nextCursor: null, hasMore: false });

    const detail = await service.get(
      seeded.context,
      seeded.workspace.id,
      created.project.id,
    );
    expect(detail.statuses.map((status) => status.rank)).toEqual(
      [...detail.statuses.map((status) => status.rank)].sort(),
    );
  });

  it("refreshes shared tag metadata on the next board read after a rename", async () => {
    const tagService = new TagService({ unitOfWork, clock: fixedClock(NOW) });
    const taskService = new TaskService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test",
    });
    const ready = statusByCategory(seeded.statuses, "ready");
    const tag = await tagService.create(seeded.context, seeded.workspace.id, {
      name: "Before",
    });
    for (const [index, title] of ["First", "Second"].entries()) {
      const task = buildTask(seeded, ready.id, title, `a${index}`);
      unitOfWork.data.tasks.set(task.id, task);
      await taskService.addTag(seeded.context, seeded.workspace.id, task.id, tag.id);
    }
    const before = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(before.data.tasks.map((task) => task.tags[0]?.name)).toEqual([
      "Before",
      "Before",
    ]);

    await tagService.update(seeded.context, seeded.workspace.id, tag.id, {
      name: "After",
      colorToken: "teal",
      description: "Updated metadata",
    });
    const after = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    for (const task of after.data.tasks) {
      expect(task.tags).toEqual([
        expect.objectContaining({
          id: tag.id,
          name: "After",
          colorToken: "teal",
          description: "Updated metadata",
        }),
      ]);
    }
    expect(before.data.tasks[0]?.tags[0]?.name).toBe("Before");
  });

  it("maps relations at both endpoints and retains blockers outside a truncated board", async () => {
    const taskService = new TaskService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test",
    });
    const ready = statusByCategory(seeded.statuses, "ready");
    const cards = ["First", "Second", "Outside"].map((title, index) =>
      buildTask(seeded, ready.id, title, `a${index}`),
    );
    for (const task of cards) unitOfWork.data.tasks.set(task.id, task);
    const [first, second, outside] = cards as [Task, Task, Task];
    await taskService.addRelation(seeded.context, seeded.workspace.id, first.id, {
      type: "related_to",
      targetTaskId: second.id,
    });
    await taskService.addRelation(seeded.context, seeded.workspace.id, outside.id, {
      type: "blocks",
      targetTaskId: second.id,
    });
    const board = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { limit: 2 },
    );
    expect(board.data.tasks.map((task) => task.title)).toEqual(["First", "Second"]);
    const [a, b] = board.data.tasks;
    expect(a?.relations.map((edge) => edge.task.id)).toEqual([second.id]);
    expect(b?.relations.map((edge) => edge.task.id).sort()).toEqual(
      [first.id, outside.id].sort(),
    );
    expect(a?.isBlocked).toBe(false);
    expect(b?.isBlocked).toBe(true);
    const list = await taskService.list(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      limit: 2,
    });
    expect(list.data.find((task) => task.id === second.id)?.relations).toEqual(
      b?.relations,
    );
  });

  it("returns one normalized ordered board and reports truncation", async () => {
    const backlog = statusByCategory(seeded.statuses, "backlog");
    const ready = statusByCategory(seeded.statuses, "ready");
    let readyRank: string | null = null;
    const tasks = [
      buildTask(seeded, backlog.id, "Backlog", "a0"),
      buildTask(
        seeded,
        ready.id,
        "Ready first",
        (readyRank = rankBetween(readyRank, null)),
      ),
      buildTask(seeded, ready.id, "Ready second", rankBetween(readyRank, null)),
    ];
    for (const task of tasks) unitOfWork.data.tasks.set(task.id, task);

    const board = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { limit: 2 },
    );

    expect(board.data.statuses).toHaveLength(6);
    expect(board.data.tasks.map((task) => task.title)).toEqual([
      "Backlog",
      "Ready first",
    ]);
    expect(board.page).toEqual({ hasMore: true, truncated: true });
  });

  it("hides subtasks by default and shows progress on the parent card", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const parent = buildTask(seeded, ready.id, "Parent", "a0");
    const openChild: Task = {
      ...buildTask(seeded, ready.id, "Open child", "a1"),
      parentTaskId: parent.id,
    };
    const doneChild: Task = {
      ...buildTask(seeded, ready.id, "Done child", "a2"),
      parentTaskId: parent.id,
      completedAt: NOW,
    };
    for (const task of [parent, openChild, doneChild]) {
      unitOfWork.data.tasks.set(task.id, task);
    }

    const hidden = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(hidden.data.tasks.map((task) => task.title)).toEqual(["Parent"]);
    expect(hidden.data.tasks[0]?.subtaskProgress).toEqual({ completed: 1, total: 2 });

    const shown = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { includeSubtasks: true },
    );
    expect(shown.data.tasks.map((task) => task.title)).toEqual([
      "Parent",
      "Open child",
      "Done child",
    ]);
    expect(shown.data.tasks[1]?.subtaskProgress).toBeNull();
  });

  it("keeps one flat card list and says which lane each card is in (GAP-19)", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const urgent: Task = {
      ...buildTask(seeded, ready.id, "Urgent", "a0"),
      priority: "urgent",
    };
    const plain = buildTask(seeded, ready.id, "Plain", "a1");
    for (const task of [urgent, plain]) unitOfWork.data.tasks.set(task.id, task);

    const flat = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(flat.data.swimlaneBy).toBe("none");
    expect(flat.data.lanes.map((lane) => lane.key)).toEqual(["all"]);

    const pivoted = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { swimlaneBy: "priority" } as never,
    );
    // Switching the pivot cannot touch manual order: the same cards, same ranks.
    expect(pivoted.data.tasks.map((task) => task.rank)).toEqual(
      flat.data.tasks.map((task) => task.rank),
    );
    expect(pivoted.data.lanes.map((lane) => lane.key)).toEqual([
      "priority:urgent",
      "priority:high",
      "priority:medium",
      "priority:low",
      "priority:none",
    ]);
    expect(pivoted.data.placements).toEqual([
      {
        taskId: urgent.id,
        columnKey: `status:${ready.id}`,
        laneKey: "priority:urgent",
      },
      { taskId: plain.id, columnKey: `status:${ready.id}`, laneKey: "priority:none" },
    ]);
  });

  it("never returns more than the 500-card hard cap", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    let rank: string | null = null;
    for (let index = 0; index < 501; index++) {
      rank = rankBetween(rank, null);
      const task = buildTask(seeded, ready.id, `Task ${index}`, rank);
      unitOfWork.data.tasks.set(task.id, task);
    }

    const board = await service.board(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { limit: 999 } as never,
    );

    expect(board.data.tasks).toHaveLength(500);
    expect(board.page).toEqual({ hasMore: true, truncated: true });
  });
});

describe("ProjectService authorization", () => {
  it("requires project read/write scopes for API keys", async () => {
    const reader: ActorContext = buildActorContext({
      actorKind: "api_key",
      workspaceIds: [seeded.workspace.id],
      scopes: new Set([SCOPES.projectsRead]),
    });

    await expect(
      service.list(reader, { workspaceId: seeded.workspace.id }),
    ).resolves.toMatchObject({ data: expect.any(Array) });
    await expect(
      service.create(reader, { workspaceId: seeded.workspace.id, name: "Denied" }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});

function buildTask(
  seededWorkspace: SeededWorkspace,
  statusId: string,
  title: string,
  rank: string,
): Task {
  return {
    id: uuidv7(),
    workspaceId: seededWorkspace.workspace.id,
    taskNumber: unitOfWork.data.tasks.size + 1,
    projectId: seededWorkspace.project.id,
    statusId,
    title,
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    reminderOffsetMinutes: null,
    parentTaskId: null,
    rank,
    lastActiveStatusId: null,
    completedAt: null,
    blockedReason: null,
    blockedSince: null,
    version: 1,
    createdBy: { kind: "user", id: seededWorkspace.userId },
    lastActor: { kind: "user", id: seededWorkspace.userId },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deletedBy: null,
  };
}

describe("ProjectService editing", () => {
  it("updates the name, description, colour, and icon with one event", async () => {
    const updated = await service.update(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { name: "  Test Project Two ", descriptionMd: "Why", colorToken: "violet" },
    );

    expect(updated).toMatchObject({
      name: "Test Project Two",
      slug: "test-project",
      descriptionMd: "Why",
      colorToken: "violet",
      version: 2,
    });
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      aggregateType: "project",
      aggregateId: seeded.project.id,
      eventType: "project.updated",
      payload: { changes: { name: { from: "Test Project", to: "Test Project Two" } } },
    });
    expect(unitOfWork.data.outbox.at(-1)?.eventType).toBe("project.updated");
  });

  it("keeps names unique but allows a project to keep its own", async () => {
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      name: "Alpha",
    });
    await expect(
      service.update(seeded.context, seeded.workspace.id, seeded.project.id, {
        name: "alpha",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      service.update(seeded.context, seeded.workspace.id, seeded.project.id, {
        name: "TEST PROJECT",
      }),
    ).resolves.toMatchObject({ name: "TEST PROJECT" });
  });

  it("rejects a stale expected version and records nothing", async () => {
    const before = unitOfWork.data.activity.length;
    await expect(
      service.update(seeded.context, seeded.workspace.id, seeded.project.id, {
        name: "Later",
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(unitOfWork.data.activity).toHaveLength(before);
  });

  it("archives and restores, hiding archived projects from the default list", async () => {
    const archived = await service.archive(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(archived.archivedAt).toBe(NOW.toISOString());
    expect(unitOfWork.data.activity.at(-1)?.eventType).toBe("project.archived");

    const visible = await service.list(seeded.context, {
      workspaceId: seeded.workspace.id,
    });
    expect(visible.data).toEqual([]);
    const all = await service.list(seeded.context, {
      workspaceId: seeded.workspace.id,
      includeArchived: true,
    });
    expect(all.data.map((project) => project.archivedAt)).toEqual([NOW.toISOString()]);
    await expect(
      service.get(seeded.context, seeded.workspace.id, seeded.project.id),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    // Archiving twice is a no-op, not an error.
    await expect(
      service.archive(seeded.context, seeded.workspace.id, seeded.project.id),
    ).resolves.toMatchObject({ version: 2 });

    const restored = await service.restore(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(restored).toMatchObject({ archivedAt: null, version: 3 });
    expect(unitOfWork.data.activity.at(-1)?.eventType).toBe("project.restored");
    expect(unitOfWork.data.outbox.at(-1)?.eventType).toBe("project.restored");
  });

  it("rolls back an archive together with its event rows", async () => {
    const before = unitOfWork.data.activity.length;
    unitOfWork.failNextCommit();
    await expect(
      service.archive(seeded.context, seeded.workspace.id, seeded.project.id),
    ).rejects.toThrow(/simulated commit failure/);
    expect(unitOfWork.data.projects.get(seeded.project.id)?.archivedAt).toBeNull();
    expect(unitOfWork.data.activity).toHaveLength(before);
  });
});
