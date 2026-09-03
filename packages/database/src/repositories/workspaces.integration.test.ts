import {
  ProjectService,
  TaskService,
  WorkspaceService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * The cross-project WIP limit against real PostgreSQL (GAP-20): the migration, the
 * workspace update with its activity and outbox rows, and the in-progress query.
 */

const NOW = new Date("2026-09-03T10:00:00.000Z");

let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;
let unitOfWork: UnitOfWork;
let projects: ProjectService;
let tasks: TaskService;

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
      email: "wip-integration@example.com",
      displayName: "WIP Integration",
      timezone: "Europe/Berlin",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_wip_integration",
  };
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "wip-integration-cursor-secret",
  });
});

describe("migration 0005_workspace_wip_limit", () => {
  it("is recorded and adds a nullable in_progress_limit column", async () => {
    const applied = await handle.pool.query(
      "select name from __morrowlist_migrations where name = $1",
      ["0005_workspace_wip_limit.sql"],
    );
    expect(applied.rowCount).toBe(1);

    const column = await handle.pool.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_name = 'workspaces' and column_name = 'in_progress_limit'`,
    );
    expect(column.rows).toEqual([{ data_type: "integer", is_nullable: "YES" }]);
  });
});

describe("WorkspaceService.update", () => {
  it("persists the limit with its activity and outbox rows", async () => {
    const service = new WorkspaceService({ unitOfWork, clock: fixedClock(NOW) });
    const updated = await service.update(context, workspaceId, { inProgressLimit: 2 });
    expect(updated).toMatchObject({ inProgressLimit: 2, version: 2 });

    const row = await handle.pool.query<{ in_progress_limit: number; version: number }>(
      "select in_progress_limit, version from workspaces where id = $1",
      [workspaceId],
    );
    expect(row.rows[0]).toEqual({ in_progress_limit: 2, version: 2 });

    const events = await handle.pool.query<{ event_type: string; payload: unknown }>(
      "select event_type, payload from activity_events where aggregate_id = $1 and event_type = 'workspace.updated'",
      [workspaceId],
    );
    expect(events.rows).toEqual([
      {
        event_type: "workspace.updated",
        payload: { workspaceId, changes: { inProgressLimit: { from: null, to: 2 } } },
      },
    ]);
    const outbox = await handle.pool.query(
      "select 1 from outbox_events where aggregate_id = $1 and event_type = 'workspace.updated'",
      [workspaceId],
    );
    expect(outbox.rowCount).toBe(1);

    const [summary] = await service.listForUser(context);
    expect(summary).toMatchObject({ inProgressLimit: 2, inProgressCount: 0 });
  });

  it("changes nothing when the transaction fails after the update", async () => {
    const failing: UnitOfWork = {
      execute: (fn) =>
        unitOfWork.execute(async (tx) => {
          await fn(tx);
          throw new Error("simulated commit failure");
        }),
    };
    const service = new WorkspaceService({
      unitOfWork: failing,
      clock: fixedClock(NOW),
    });

    await expect(
      service.update(context, workspaceId, { inProgressLimit: 2 }),
    ).rejects.toThrow(/simulated commit failure/);

    const row = await handle.pool.query<{ in_progress_limit: number | null }>(
      "select in_progress_limit, version from workspaces where id = $1",
      [workspaceId],
    );
    expect(row.rows[0]).toEqual({ in_progress_limit: null, version: 1 });
    const events = await handle.pool.query(
      "select 1 from activity_events where event_type = 'workspace.updated'",
    );
    expect(events.rowCount).toBe(0);
  });
});

describe("in-progress inventory", () => {
  it("lists open tasks in in-progress columns across projects, in project then rank order", async () => {
    const alpha = await projects.create(context, { workspaceId, name: "Alpha" });
    const beta = await projects.create(context, { workspaceId, name: "Beta" });
    const doingIn = (detail: typeof alpha) => {
      const status = detail.statuses.find((s) => s.category === "in_progress");
      if (!status) throw new Error("default workflow is incomplete");
      return status.id;
    };

    const first = await tasks.create(context, {
      workspaceId,
      projectId: alpha.project.id,
      statusId: doingIn(alpha),
      title: "Alpha first",
    });
    const second = await tasks.create(context, {
      workspaceId,
      projectId: alpha.project.id,
      statusId: doingIn(alpha),
      title: "Alpha second",
    });
    const elsewhere = await tasks.create(context, {
      workspaceId,
      projectId: beta.project.id,
      statusId: doingIn(beta),
      title: "Beta started",
    });
    await tasks.create(context, {
      workspaceId,
      projectId: beta.project.id,
      title: "Beta not started",
    });
    const trashed = await tasks.create(context, {
      workspaceId,
      projectId: beta.project.id,
      statusId: doingIn(beta),
      title: "Beta trashed",
    });
    await tasks.delete(context, workspaceId, trashed.id);

    const expected = [alpha.project.id, beta.project.id].sort();
    await unitOfWork.execute(async (tx) => {
      const inProgress = await tx.tasks.listInProgress(workspaceId);
      const byProject = inProgress.map((task) => task.projectId);
      expect([...new Set(byProject)]).toEqual(expected);
      const ids = inProgress.map((task) => task.id);
      expect(ids).toHaveLength(3);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
      expect(ids).toContain(elsewhere.id);
      expect(ids).not.toContain(trashed.id);
    });
  });
});
