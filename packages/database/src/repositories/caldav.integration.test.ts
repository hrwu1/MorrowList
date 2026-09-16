import { bootstrapUser, type UnitOfWork } from "@morrowlist/application";
import { uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let workspaceId: string;
let userId: string;
beforeAll(async () => {
  handle = await setupTestDatabase();
});
afterAll(async () => {
  await teardownTestDatabase();
});
beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  userId = uuidv7();
  const result = await bootstrapUser(
    { unitOfWork },
    { userId, email: "caldav@example.com", displayName: "CalDAV", timezone: "UTC" },
  );
  workspaceId = result.workspace.id;
});

async function insertTask(
  id: string,
  number: number,
  updatedAt: string,
  deleted = false,
) {
  await handle.pool.query(
    `insert into tasks (id, workspace_id, task_number, title, rank, created_by_actor_kind, created_by_actor_id, last_actor_kind, last_actor_id, created_at, updated_at, deleted_at)
     values ($1, $2, $3::int, 'Task ' || $3::text, 'a' || lpad($3::text, 5, '0'), 'user', $4, 'user', $4, $5, $5, $6)`,
    [id, workspaceId, String(number), userId, updatedAt, deleted ? updatedAt : null],
  );
}

describe("CalDAV PostgreSQL", () => {
  it("lists changes since a point, trashed included, and stamps the workspace", async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    await insertTask(a, 1, "2026-09-16T10:00:00Z");
    await insertTask(b, 2, "2026-09-16T11:00:00Z", true);
    await insertTask(c, 3, "2026-09-16T12:00:00Z");
    await unitOfWork.execute(async (tx) => {
      const all = await tx.tasks.listChangedSince(workspaceId, null, 10);
      expect(all.items.map((t) => t.id)).toEqual([a, b, c]);
      expect(all.truncated).toBe(false);
      const since = await tx.tasks.listChangedSince(
        workspaceId,
        new Date("2026-09-16T11:00:00Z"),
        10,
      );
      expect(since.items.map((t) => t.id)).toEqual([b, c]);
      expect(since.items[0]!.deletedAt).not.toBeNull();
      const bounded = await tx.tasks.listChangedSince(workspaceId, null, 1);
      expect(bounded.items.map((t) => t.id)).toEqual([a]);
      expect(bounded.truncated).toBe(true);
      expect(await tx.tasks.syncStamp(workspaceId)).toEqual({
        latest: new Date("2026-09-16T12:00:00Z"),
        count: 3,
      });
      expect(await tx.tasks.syncStamp(uuidv7())).toEqual({ latest: null, count: 0 });
    });
  });

  it("stores client resource names and properties, and follows task deletion", async () => {
    const taskId = uuidv7();
    const other = uuidv7();
    await insertTask(taskId, 1, "2026-09-16T10:00:00Z");
    await insertTask(other, 2, "2026-09-16T10:00:00Z");
    const object = {
      workspaceId,
      taskId,
      resource: "task" as const,
      path: "ABC-123",
      uid: "ABC-123",
      properties: [["location", {}, "text", "Room 4"]],
      updatedAt: new Date("2026-09-16T10:30:00Z"),
    };
    await unitOfWork.execute(async (tx) => {
      await tx.caldavObjects.upsert(object);
      expect(await tx.caldavObjects.findByPath(workspaceId, "ABC-123")).toEqual(object);
      expect(await tx.caldavObjects.findByUid(workspaceId, "ABC-123")).toEqual(object);
      expect(await tx.caldavObjects.findByPath(uuidv7(), "ABC-123")).toBeNull();
      await tx.caldavObjects.upsert({
        ...object,
        properties: [],
        updatedAt: new Date("2026-09-16T11:00:00Z"),
      });
      const rows = await tx.caldavObjects.listByTask(workspaceId, taskId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.properties).toEqual([]);
    });
    // A second task cannot claim the same resource name; the violation aborts its own
    // transaction only.
    await expect(
      unitOfWork.execute((tx) =>
        tx.caldavObjects.upsert({ ...object, taskId: other, uid: "other" }),
      ),
    ).rejects.toThrow();
    await unitOfWork.execute(async (tx) => {
      await tx.caldavObjects.upsert({
        ...object,
        resource: "deadline",
        path: `${taskId}-deadline`,
        uid: `${taskId}-deadline@morrowlist`,
      });
      expect(await tx.caldavObjects.listByWorkspace(workspaceId)).toHaveLength(2);
      await tx.caldavObjects.delete(workspaceId, taskId, "deadline");
      expect(await tx.caldavObjects.listByWorkspace(workspaceId)).toHaveLength(1);
    });
    await handle.pool.query("delete from tasks where id = $1", [taskId]);
    await unitOfWork.execute(async (tx) => {
      expect(await tx.caldavObjects.findByPath(workspaceId, "ABC-123")).toBeNull();
    });
  });
});
