import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { SCOPES, type ActorContext } from "../shared/actor-context.js";
import { TaskService } from "../tasks/service.js";
import {
  buildActorContext,
  buildProject,
  buildDefaultWorkflow,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { WorkspaceService } from "./service.js";

const NOW = new Date("2026-09-03T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let service: WorkspaceService;
let seeded: SeededWorkspace;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  service = new WorkspaceService({ unitOfWork, clock: fixedClock(NOW) });
});

describe("WorkspaceService.update", () => {
  it("sets the in-progress limit and records the event in one transaction", async () => {
    const updated = await service.update(seeded.context, seeded.workspace.id, {
      inProgressLimit: 3,
    });

    expect(updated).toMatchObject({ inProgressLimit: 3, version: 2 });
    expect(updated.updatedAt).toBe(NOW.toISOString());
    expect(unitOfWork.data.workspaces.get(seeded.workspace.id)?.inProgressLimit).toBe(
      3,
    );
    expect(unitOfWork.data.activity.map((event) => event.eventType)).toEqual([
      "workspace.updated",
    ]);
    expect(unitOfWork.data.activity[0]?.payload).toEqual({
      workspaceId: seeded.workspace.id,
      changes: { inProgressLimit: { from: null, to: 3 } },
    });
    expect(unitOfWork.data.outbox.map((event) => event.eventType)).toEqual([
      "workspace.updated",
    ]);
  });

  it("clears the limit with an explicit null and leaves omitted fields alone", async () => {
    await service.update(seeded.context, seeded.workspace.id, { inProgressLimit: 2 });
    const cleared = await service.update(seeded.context, seeded.workspace.id, {
      inProgressLimit: null,
      name: "  Focus  ",
    });
    expect(cleared).toMatchObject({
      inProgressLimit: null,
      name: "Focus",
      taskKeyPrefix: "ML",
      timezone: "Europe/Berlin",
      version: 3,
    });
  });

  it("changes nothing and records nothing when the values are unchanged", async () => {
    const same = await service.update(seeded.context, seeded.workspace.id, {
      inProgressLimit: null,
    });
    expect(same.version).toBe(1);
    expect(unitOfWork.data.activity).toHaveLength(0);
  });

  it("rejects an invalid limit, timezone, or stale version without writing", async () => {
    await expect(
      service.update(seeded.context, seeded.workspace.id, { inProgressLimit: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      service.update(seeded.context, seeded.workspace.id, { timezone: "Mars/Olympus" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      service.update(seeded.context, seeded.workspace.id, {
        inProgressLimit: 1,
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(unitOfWork.data.activity).toHaveLength(0);
  });

  it("rolls back the limit with its events when the commit fails", async () => {
    unitOfWork.failNextCommit();
    await expect(
      service.update(seeded.context, seeded.workspace.id, { inProgressLimit: 1 }),
    ).rejects.toThrow(/simulated commit failure/);
    expect(unitOfWork.data.workspaces.get(seeded.workspace.id)?.inProgressLimit).toBe(
      null,
    );
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });

  it("hides another workspace and refuses a member or an unscoped key", async () => {
    const other = seedWorkspace(unitOfWork.data, {
      workspace: { slug: "other", name: "Other" },
    });
    await expect(
      service.update(seeded.context, other.workspace.id, { inProgressLimit: 1 }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });

    const member: ActorContext = buildActorContext({
      workspaceIds: [seeded.workspace.id],
    });
    unitOfWork.data.memberships.push({
      workspaceId: seeded.workspace.id,
      userId: member.userId as string,
      role: "member",
      joinedAt: NOW,
    });
    await expect(
      service.update(member, seeded.workspace.id, { inProgressLimit: 1 }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });

    const apiKey = buildActorContext({
      actorKind: "api_key",
      workspaceIds: [seeded.workspace.id],
      scopes: new Set([SCOPES.tasksWrite]),
    });
    await expect(
      service.update(apiKey, seeded.workspace.id, { inProgressLimit: 1 }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});

describe("WorkspaceService.listForUser", () => {
  it("counts started work across projects beside the limit", async () => {
    const tasks = new TaskService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "secret",
    });
    const second = buildProject(seeded.workspace.id, {
      name: "Second",
      slug: "second",
    });
    const secondStatuses = buildDefaultWorkflow(second.id);
    unitOfWork.data.projects.set(second.id, second);
    for (const status of secondStatuses)
      unitOfWork.data.statuses.set(status.id, status);

    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Started here",
      projectId: seeded.project.id,
      statusId: statusByCategory(seeded.statuses, "in_progress").id,
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Started there",
      projectId: second.id,
      statusId: statusByCategory(secondStatuses, "in_progress").id,
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Not started",
      projectId: second.id,
    });
    await service.update(seeded.context, seeded.workspace.id, { inProgressLimit: 1 });

    const [summary] = await service.listForUser(seeded.context);
    expect(summary).toMatchObject({
      id: seeded.workspace.id,
      role: "owner",
      inProgressLimit: 1,
      inProgressCount: 2,
    });
  });

  it("refuses a credential with no user", async () => {
    const apiKey = buildActorContext({ actorKind: "api_key" });
    await expect(
      service.listForUser({ ...apiKey, userId: undefined } as ActorContext),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});
