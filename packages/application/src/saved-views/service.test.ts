import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildActorContext,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { SavedViewService } from "./service.js";

const NOW = new Date("2026-09-03T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let views: SavedViewService;
let seeded: SeededWorkspace;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  views = new SavedViewService({ unitOfWork, clock: fixedClock(NOW) });
});

function create(name: string, filters: Record<string, unknown> = {}) {
  return views.create(seeded.context, seeded.workspace.id, {
    name,
    filters,
    layout: "list",
  } as never);
}

describe("SavedViewService.create", () => {
  it("saves a personal view at the end of the sidebar with both event rows", async () => {
    const first = await create("Overdue research", { due: "overdue" });
    const second = await create("  Blocked   work ", { isBlocked: true });

    expect(first).toMatchObject({
      name: "Overdue research",
      ownerUserId: seeded.userId,
      filters: { due: "overdue" },
      layout: "list",
    });
    expect(second.name).toBe("Blocked work");
    expect(first.rank < second.rank).toBe(true);
    expect(unitOfWork.data.activity.map((event) => event.eventType)).toEqual([
      "saved_view.created",
      "saved_view.created",
    ]);
    expect(unitOfWork.data.outbox[0]).toMatchObject({
      aggregateType: "saved_view",
      aggregateId: first.id,
      payload: {
        viewId: first.id,
        name: "Overdue research",
        filters: { due: "overdue" },
      },
    });
  });

  it("rejects a name that differs only by case", async () => {
    await create("Overdue research");

    await expect(create("overdue RESEARCH")).rejects.toMatchObject({
      code: "SAVED_VIEW_NAME_CONFLICT",
    });
  });

  it("refuses a credential with no user behind it", async () => {
    const apiKey = buildActorContext({
      actorKind: "api_key",
      actorId: "key_1",
      workspaceIds: [seeded.workspace.id],
      scopes: new Set(["views:read", "views:write"]),
    });
    const keyContext = { ...apiKey, userId: undefined } as never;

    await expect(
      views.create(keyContext, seeded.workspace.id, {
        name: "Mine",
        filters: {},
        layout: "list",
      }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });

  it("rolls back the view and both event rows when the commit fails", async () => {
    unitOfWork.failNextCommit();

    await expect(create("Doomed")).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.savedViews.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });
});

describe("owner isolation", () => {
  it("hides a view from another member of the same workspace", async () => {
    const mine = await create("Mine");
    const otherUserId = uuidv7();
    unitOfWork.data.memberships.push({
      workspaceId: seeded.workspace.id,
      userId: otherUserId,
      role: "member",
      joinedAt: NOW,
    });
    const other = buildActorContext({
      userId: otherUserId,
      workspaceIds: [seeded.workspace.id],
    });

    const listed = await views.list(other, seeded.workspace.id);
    expect(listed.data).toEqual([]);
    await expect(
      views.update(other, seeded.workspace.id, mine.id, { name: "Stolen" }),
    ).rejects.toMatchObject({ code: "SAVED_VIEW_NOT_FOUND" });
    await expect(
      views.delete(other, seeded.workspace.id, mine.id),
    ).rejects.toMatchObject({ code: "SAVED_VIEW_NOT_FOUND" });
    await expect(
      views.reorder(other, seeded.workspace.id, mine.id, {}),
    ).rejects.toMatchObject({ code: "SAVED_VIEW_NOT_FOUND" });

    // The other member can use the same name for their own view.
    await expect(
      views.create(other, seeded.workspace.id, {
        name: "mine",
        filters: {},
        layout: "list",
      }),
    ).resolves.toMatchObject({ ownerUserId: otherUserId });
    expect((await views.list(seeded.context, seeded.workspace.id)).data).toHaveLength(
      1,
    );
  });
});

describe("SavedViewService.update and delete", () => {
  it("renames, refilters, and relayouts with a readable diff", async () => {
    const view = await create("Overdue", { due: "overdue" });

    const updated = await views.update(seeded.context, seeded.workspace.id, view.id, {
      name: "Overdue board",
      layout: "board",
      filters: { due: "overdue", priority: "high" },
    });

    expect(updated).toMatchObject({
      name: "Overdue board",
      layout: "board",
      filters: { due: "overdue", priority: "high" },
    });
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "saved_view.updated",
      payload: {
        changes: {
          name: { from: "Overdue", to: "Overdue board" },
          layout: { from: "list", to: "board" },
          filters: {
            from: { due: "overdue" },
            to: { due: "overdue", priority: "high" },
          },
        },
      },
    });
  });

  it("records nothing for an update that changes nothing", async () => {
    const view = await create("Same", { due: "overdue" });

    await views.update(seeded.context, seeded.workspace.id, view.id, {
      filters: { due: "overdue" },
    });

    expect(unitOfWork.data.activity).toHaveLength(1);
  });

  it("deletes a view and records the deletion", async () => {
    const view = await create("Gone");

    await views.delete(seeded.context, seeded.workspace.id, view.id);

    expect(unitOfWork.data.savedViews.size).toBe(0);
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "saved_view.deleted",
      payload: { viewId: view.id, name: "Gone" },
    });
  });
});

describe("SavedViewService.reorder", () => {
  it("places a view between two neighbours and lists in the new order", async () => {
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");

    await views.reorder(seeded.context, seeded.workspace.id, c.id, {
      beforeViewId: a.id,
      afterViewId: b.id,
    });
    const listed = await views.list(seeded.context, seeded.workspace.id);
    expect(listed.data.map((view) => view.name)).toEqual(["A", "C", "B"]);

    await views.reorder(seeded.context, seeded.workspace.id, b.id, {
      afterViewId: a.id,
    });
    const moved = await views.list(seeded.context, seeded.workspace.id);
    expect(moved.data.map((view) => view.name)).toEqual(["B", "A", "C"]);
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "saved_view.updated",
      summary: "Reordered view B",
    });
  });

  it("rejects a neighbour that is not one of the owner's views", async () => {
    const a = await create("A");

    await expect(
      views.reorder(seeded.context, seeded.workspace.id, a.id, {
        afterViewId: uuidv7(),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "afterViewId" },
    });
  });
});
