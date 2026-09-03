import {
  ProjectService,
  TaskService,
  WorkflowService,
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
 * Workflow editing against real PostgreSQL (GAP-05): the `policy_md` migration, and the
 * atomicity of move-and-archive, which only a real transaction can prove.
 */

const NOW = new Date("2026-09-01T10:00:00.000Z");

let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;
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
  const unitOfWork = createUnitOfWork(handle);
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "workflow-integration@example.com",
      displayName: "Workflow Integration",
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
    requestId: "req_workflow_integration",
  };
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "workflow-integration-cursor-secret",
  });
});

describe("migration 0003_status_policy", () => {
  it("is recorded and adds a nullable policy_md column", async () => {
    const applied = await handle.pool.query(
      "select name from __morrowlist_migrations where name = $1",
      ["0003_status_policy.sql"],
    );
    expect(applied.rowCount).toBe(1);

    const column = await handle.pool.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_name = 'workflow_statuses' and column_name = 'policy_md'`,
    );
    expect(column.rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
  });

  it("round-trips a column policy through the status repository", async () => {
    const detail = await projects.create(context, { workspaceId, name: "Policies" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    if (!ready) throw new Error("default workflow is incomplete");
    expect(ready.policyMd).toBeNull();

    const unitOfWork = createUnitOfWork(handle);
    await unitOfWork.execute(async (tx) => {
      const status = await tx.statuses.findById(ready.id);
      if (!status) throw new Error("status vanished");
      expect(
        await tx.statuses.update(
          { ...status, policyMd: "Small, reviewed, ready to start.", version: 2 },
          1,
        ),
      ).toBe(true);
    });

    const reloaded = await projects.get(context, workspaceId, detail.project.id);
    expect(reloaded.statuses.find((status) => status.id === ready.id)).toMatchObject({
      policyMd: "Small, reviewed, ready to start.",
      version: 2,
    });
  });
});

describe("column task inventory", () => {
  it("lists and counts a column's tasks, trashed ones included", async () => {
    const detail = await projects.create(context, { workspaceId, name: "Inventory" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    if (!ready) throw new Error("default workflow is incomplete");

    const kept = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Kept",
    });
    const trashed = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Trashed",
    });
    await tasks.delete(context, workspaceId, trashed.id);

    const unitOfWork = createUnitOfWork(handle);
    await unitOfWork.execute(async (tx) => {
      expect(await tx.statuses.countTasks(ready.id)).toBe(2);
      const inStatus = await tx.tasks.listInStatus(workspaceId, ready.id);
      expect(inStatus.map((task) => task.id)).toEqual([kept.id, trashed.id]);
    });
  });
});

describe("archive-and-move atomicity", () => {
  async function seedColumn() {
    const detail = await projects.create(context, { workspaceId, name: "Atomic" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    const progress = detail.statuses.find(
      (status) => status.category === "in_progress",
    );
    const backlog = detail.statuses.find((status) => status.category === "backlog");
    if (!ready || !progress || !backlog) throw new Error("default workflow incomplete");

    const live = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Live",
    });
    const trashed = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Trashed",
    });
    await tasks.delete(context, workspaceId, trashed.id);
    return { detail, ready, progress, backlog, live, trashed };
  }

  async function snapshot() {
    const rows = await handle.pool.query<{
      id: string;
      status_id: string;
      version: number;
    }>("select id, status_id, version from tasks order by task_number");
    const statuses = await handle.pool.query<{
      id: string;
      archived_at: Date | null;
      is_default: boolean;
      version: number;
    }>(
      "select id, archived_at, is_default, version from workflow_statuses order by rank",
    );
    const events = await handle.pool.query<{ count: string }>(
      "select (select count(*) from activity_events) + (select count(*) from outbox_events) as count",
    );
    return {
      tasks: rows.rows,
      statuses: statuses.rows,
      events: Number(events.rows[0]?.count),
    };
  }

  it("moves every task and archives the column in one transaction", async () => {
    const { detail, ready, progress, backlog, live, trashed } = await seedColumn();
    const unitOfWork = createUnitOfWork(handle);
    const workflow = new WorkflowService({ unitOfWork, clock: fixedClock(NOW) });

    const archived = await workflow.archive(context, workspaceId, ready.id, {
      destinationStatusId: progress.id,
      newDefaultStatusId: backlog.id,
    });
    expect(archived.archivedAt).toBe(NOW.toISOString());

    const after = await snapshot();
    expect(after.tasks.map((row) => [row.id, row.status_id])).toEqual([
      [live.id, progress.id],
      [trashed.id, progress.id],
    ]);
    expect(after.statuses.find((row) => row.id === ready.id)).toMatchObject({
      archived_at: NOW,
      is_default: false,
      version: 2,
    });
    expect(after.statuses.find((row) => row.id === backlog.id)).toMatchObject({
      is_default: true,
      version: 2,
    });
    // The partial unique index still sees exactly one active default.
    const defaults = await handle.pool.query(
      "select count(*)::int as count from workflow_statuses where project_id = $1 and is_default and archived_at is null",
      [detail.project.id],
    );
    expect(defaults.rows[0]?.count).toBe(1);

    const events = await handle.pool.query<{
      event_type: string;
      aggregate_id: string;
    }>(
      "select event_type, aggregate_id from activity_events where correlation_id = $1 order by id",
      [context.requestId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "task.moved",
        "task.moved",
        "workflow_status.updated",
        "workflow_status.archived",
      ]),
    );
  });

  it("changes nothing when the transaction fails after the moves and the archive", async () => {
    const { ready, progress } = await seedColumn();
    const before = await snapshot();
    const real = createUnitOfWork(handle);
    // Runs the whole command, then fails the transaction: every row it wrote must vanish.
    const failing: UnitOfWork = {
      execute: (fn) =>
        real.execute(async (tx) => {
          await fn(tx);
          throw new Error("simulated commit failure");
        }),
    };
    const workflow = new WorkflowService({
      unitOfWork: failing,
      clock: fixedClock(NOW),
    });

    await expect(
      workflow.archive(context, workspaceId, ready.id, {
        destinationStatusId: progress.id,
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(await snapshot()).toEqual(before);
  });

  it("rejects an invalid destination before touching any row", async () => {
    const { ready, progress } = await seedColumn();
    await handle.pool.query(
      "update workflow_statuses set archived_at = $1 where id = $2",
      [NOW, progress.id],
    );
    const before = await snapshot();
    const workflow = new WorkflowService({
      unitOfWork: createUnitOfWork(handle),
      clock: fixedClock(NOW),
    });

    await expect(
      workflow.archive(context, workspaceId, ready.id, {
        destinationStatusId: progress.id,
      }),
    ).rejects.toMatchObject({ code: "STATUS_NOT_FOUND" });
    await expect(
      workflow.archive(context, workspaceId, ready.id, {}),
    ).rejects.toMatchObject({ code: "STATUS_ARCHIVE_REQUIRES_DESTINATION" });

    expect(await snapshot()).toEqual(before);
  });
});
