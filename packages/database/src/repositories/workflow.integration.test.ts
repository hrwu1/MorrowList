import {
  ProjectService,
  TaskService,
  bootstrapUser,
  type ActorContext,
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
