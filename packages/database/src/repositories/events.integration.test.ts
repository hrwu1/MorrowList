import {
  ProjectService,
  TaskService,
  bootstrapUser,
  type ActivityEvent,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { fixedClock, uuidv7, uuidv7At } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import { activityEvents } from "../schema/index.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Activity read model against real PostgreSQL (GAP-09, spec 29.1): a heavily edited task
 * carries 1,000+ events and must page through them without a gap or a repeat, and the
 * first page must come back inside the read budget (spec 29.2).
 */

const NOW = new Date("2026-08-29T09:00:00.000Z");
const HEAVY_EVENT_COUNT = 1_200;
const PAGE_SIZE = 50;

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;
let tasks: TaskService;
let projects: ProjectService;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "activity-integration@example.com",
      displayName: "Activity Integration",
      timezone: "Europe/Berlin",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Activity Integration",
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_activity_integration",
  };
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "integration-cursor-secret",
  });
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
});

/** Bulk-append history rows; every third row shares a timestamp to exercise the tie-break. */
async function appendHistory(taskId: string, count: number): Promise<void> {
  const base = NOW.getTime() + 1_000;
  const rows = Array.from({ length: count }, (_, index) => {
    const createdAt = new Date(base + Math.floor(index / 3) * 1_000);
    return {
      id: uuidv7At(createdAt.getTime()),
      workspaceId,
      aggregateType: "task" as const,
      aggregateId: taskId,
      eventType: "task.updated",
      actorKind: "user" as const,
      actorId: context.actorId,
      actorDisplayName: "Activity Integration",
      summary: `Updated task fields (${index})`,
      payload: {
        taskId,
        changes: { title: { from: `v${index}`, to: `v${index + 1}` } },
      },
      correlationId: `req_bulk_${index}`,
      createdAt,
    };
  });
  for (let offset = 0; offset < rows.length; offset += 200) {
    await handle.db.insert(activityEvents).values(rows.slice(offset, offset + 200));
  }
}

function listTaskActivity(taskId: string, after?: string) {
  return unitOfWork.execute((tx) =>
    tx.activity.listForAggregate(workspaceId, "task", taskId, {
      limit: PAGE_SIZE,
      after,
    }),
  );
}

function isNewestFirst(events: readonly ActivityEvent[]): boolean {
  return events.every((event, index) => {
    const previous = events[index - 1];
    if (!previous) return true;
    const byTime = previous.createdAt.getTime() - event.createdAt.getTime();
    return byTime > 0 || (byTime === 0 && previous.id > event.id);
  });
}

describe("activity pagination", () => {
  it("pages 1,200 events on one task without a gap or a repeat", async () => {
    const task = await tasks.create(context, { workspaceId, title: "Heavily edited" });
    await appendHistory(task.id, HEAVY_EVENT_COUNT - 1);

    const started = performance.now();
    const first = await listTaskActivity(task.id);
    const firstPageMs = performance.now() - started;

    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(firstPageMs).toBeLessThan(300);

    const seen: ActivityEvent[] = [...first.items];
    let page = first;
    while (page.hasMore) {
      const last = page.items.at(-1);
      page = await listTaskActivity(task.id, last?.id);
      seen.push(...page.items);
    }

    expect(seen).toHaveLength(HEAVY_EVENT_COUNT);
    expect(new Set(seen.map((event) => event.id)).size).toBe(HEAVY_EVENT_COUNT);
    expect(isNewestFirst(seen)).toBe(true);
    // The task's own creation is the oldest row, so it closes the walk.
    expect(seen.at(-1)?.eventType).toBe("task.created");
    expect(page.hasMore).toBe(false);
  });

  it("treats an unknown anchor as the first page and stays inside the workspace", async () => {
    const task = await tasks.create(context, { workspaceId, title: "Anchored" });
    const other = await tasks.create(context, { workspaceId, title: "Other" });

    const page = await listTaskActivity(task.id, uuidv7());
    expect(page.items.map((event) => event.aggregateId)).toEqual([task.id]);

    const foreign = await unitOfWork.execute((tx) =>
      tx.activity.listForAggregate(uuidv7(), "task", other.id, { limit: 10 }),
    );
    expect(foreign.items).toHaveLength(0);
  });
});

describe("project activity", () => {
  it("lists the project's own events and those of the tasks in it", async () => {
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const inProject = await tasks.create(context, {
      workspaceId,
      title: "In the project",
      projectId: detail.project.id,
    });
    await tasks.update(context, workspaceId, inProject.id, { title: "Renamed" });
    await tasks.create(context, { workspaceId, title: "Inbox only" });

    const page = await unitOfWork.execute((tx) =>
      tx.activity.listForProject(workspaceId, detail.project.id, { limit: 10 }),
    );

    expect(page.items.map((event) => event.eventType)).toEqual([
      "task.updated",
      "task.created",
      "project.created",
    ]);
    expect(page.hasMore).toBe(false);
  });
});
