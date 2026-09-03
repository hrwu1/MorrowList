import { TaskService, bootstrapUser, type ActorContext } from "@morrowlist/application";
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
 * Tag persistence against real PostgreSQL (GAP-03, spec 12.1). Migration 0003 carries a
 * unique index, two cascading foreign keys, and a pinned collation; none of those can be
 * demonstrated by the in-memory doubles.
 */

const NOW = new Date("2026-09-03T09:00:00.000Z");

let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;
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
      email: "tags-integration@example.com",
      displayName: "Tags Integration",
      timezone: "UTC",
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
    requestId: "req_tags_integration",
  };
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "tags-integration-cursor-secret",
  });
});

async function insertTag(name: string, normalizedName = name.toLowerCase()) {
  const id = uuidv7();
  await handle.pool.query(
    `insert into tags (id, workspace_id, name, normalized_name, color_token, created_at, updated_at)
     values ($1, $2, $3, $4, 'blue', now(), now())`,
    [id, workspaceId, name, normalizedName],
  );
  return id;
}

describe("migration 0003", () => {
  it("rejects a second tag whose normalized name already exists in the workspace", async () => {
    await insertTag("Deep Work", "deep work");

    await expect(insertTag("deep work", "deep work")).rejects.toThrow(
      /tags_workspace_normalized_name_key/,
    );
  });

  it("allows the same normalized name in another workspace", async () => {
    const otherUserId = uuidv7();
    const { workspace: other } = await bootstrapUser(
      { unitOfWork: createUnitOfWork(handle), clock: fixedClock(NOW) },
      { userId: otherUserId, email: "other@example.com", timezone: "UTC" },
    );
    await insertTag("Deep Work", "deep work");

    await expect(
      handle.pool.query(
        `insert into tags (id, workspace_id, name, normalized_name, color_token, created_at, updated_at)
         values ($1, $2, 'Deep Work', 'deep work', 'blue', now(), now())`,
        [uuidv7(), other.id],
      ),
    ).resolves.toBeDefined();
  });

  it("removes associations, never tasks, when a tag is deleted", async () => {
    const task = await tasks.create(context, { workspaceId, title: "Tagged" });
    const tagId = await insertTag("Focus");
    await handle.pool.query(
      "insert into task_tags (task_id, tag_id, created_at) values ($1, $2, now())",
      [task.id, tagId],
    );

    await handle.pool.query("delete from tags where id = $1", [tagId]);

    const associations = await handle.pool.query(
      "select tag_id from task_tags where task_id = $1",
      [task.id],
    );
    expect(associations.rows).toHaveLength(0);
    const survivor = await handle.pool.query("select id from tasks where id = $1", [
      task.id,
    ]);
    expect(survivor.rows).toHaveLength(1);
  });

  it("removes associations when a task is hard deleted, keeping the tag", async () => {
    const task = await tasks.create(context, { workspaceId, title: "Doomed" });
    const tagId = await insertTag("Focus");
    await handle.pool.query(
      "insert into task_tags (task_id, tag_id, created_at) values ($1, $2, now())",
      [task.id, tagId],
    );

    await handle.pool.query("delete from tasks where id = $1", [task.id]);

    const associations = await handle.pool.query(
      "select task_id from task_tags where tag_id = $1",
      [tagId],
    );
    expect(associations.rows).toHaveLength(0);
    const tag = await handle.pool.query("select id from tags where id = $1", [tagId]);
    expect(tag.rows).toHaveLength(1);
  });

  it("rejects the same tag on a task twice", async () => {
    const task = await tasks.create(context, { workspaceId, title: "Once" });
    const tagId = await insertTag("Focus");
    await handle.pool.query(
      "insert into task_tags (task_id, tag_id, created_at) values ($1, $2, now())",
      [task.id, tagId],
    );

    await expect(
      handle.pool.query(
        "insert into task_tags (task_id, tag_id, created_at) values ($1, $2, now())",
        [task.id, tagId],
      ),
    ).rejects.toThrow(/task_tags_task_id_tag_id_pk/);
  });

  it("orders normalized names by code point, not by locale", async () => {
    // The response order must match the in-memory double's string comparison.
    for (const name of ["a-b", "ab", "a b", "Zed", "zed2"]) {
      await insertTag(name, name.toLowerCase());
    }

    const { rows } = await handle.pool.query<{ normalized_name: string }>(
      "select normalized_name from tags where workspace_id = $1 order by normalized_name",
      [workspaceId],
    );

    expect(rows.map((row) => row.normalized_name)).toEqual(
      ["a-b", "ab", "a b", "zed", "zed2"].sort((a, b) => (a < b ? -1 : 1)),
    );
  });
});
