import { fixedClock, rankBetween, uuidv7, type Task } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { SCOPES, type ActorContext } from "../shared/actor-context.js";
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
    parentTaskId: null,
    rank,
    lastActiveStatusId: null,
    completedAt: null,
    version: 1,
    createdBy: { kind: "user", id: seededWorkspace.userId },
    lastActor: { kind: "user", id: seededWorkspace.userId },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deletedBy: null,
  };
}
