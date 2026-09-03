import { TaskService, bootstrapUser, type ActorContext } from "@morrowlist/application";
import { fixedClock, uuidv7, type TaskRelation } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Task relations and the blocker flag against real PostgreSQL (GAP-06, spec 8.4).
 * Migration 0005 carries a unique edge index, a self-relation check, cascading foreign
 * keys, and the paired blocked columns; the repository adds a recursive walk and an
 * EXISTS predicate that only SQL can prove.
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
      email: "relations-integration@example.com",
      displayName: "Relations Integration",
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
    requestId: "req_relations_integration",
  };
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "relations-integration-cursor-secret",
  });
});

function relation(
  sourceTaskId: string,
  targetTaskId: string,
  type: TaskRelation["type"] = "blocks",
): TaskRelation {
  return {
    id: uuidv7(),
    workspaceId,
    sourceTaskId,
    targetTaskId,
    type,
    metadata: {},
    createdBy: { kind: "user", id: context.actorId },
    createdAt: NOW,
  };
}

async function insertRelation(
  sourceTaskId: string,
  targetTaskId: string,
  type: TaskRelation["type"] = "blocks",
) {
  const row = relation(sourceTaskId, targetTaskId, type);
  await handle.pool.query(
    `insert into task_relations (id, workspace_id, source_task_id, target_task_id, type, metadata, created_by_actor_kind, created_by_actor_id, created_at)
     values ($1, $2, $3, $4, $5, '{}', 'user', $6, now())`,
    [row.id, workspaceId, sourceTaskId, targetTaskId, type, context.actorId],
  );
  return row.id;
}

async function createTask(title: string) {
  return tasks.create(context, { workspaceId, title });
}

describe("migration 0005", () => {
  it("rejects a task related to itself", async () => {
    const task = await createTask("Solo");

    await expect(insertRelation(task.id, task.id)).rejects.toThrow(
      /task_relations_no_self/,
    );
  });

  it("rejects the same edge twice but allows the other type and direction", async () => {
    const a = await createTask("A");
    const b = await createTask("B");
    await insertRelation(a.id, b.id);

    await expect(insertRelation(a.id, b.id)).rejects.toThrow(/task_relations_edge_key/);
    await expect(insertRelation(a.id, b.id, "related_to")).resolves.toBeDefined();
    // The reverse blocks edge is a cycle, which the application rejects; the schema
    // only guards uniqueness.
    await expect(insertRelation(b.id, a.id)).resolves.toBeDefined();
  });

  it("removes relations when either endpoint is hard deleted", async () => {
    const a = await createTask("A");
    const b = await createTask("B");
    await insertRelation(a.id, b.id);

    await handle.pool.query("delete from tasks where id = $1", [b.id]);

    const remaining = await handle.pool.query("select id from task_relations");
    expect(remaining.rows).toHaveLength(0);
    const survivor = await handle.pool.query("select id from tasks where id = $1", [
      a.id,
    ]);
    expect(survivor.rows).toHaveLength(1);
  });

  it("keeps the blocked reason and its start together", async () => {
    const task = await createTask("Flagged");

    await expect(
      handle.pool.query("update tasks set blocked_reason = 'vendor' where id = $1", [
        task.id,
      ]),
    ).rejects.toThrow(/tasks_blocked_reason_with_since/);
    await expect(
      handle.pool.query(
        "update tasks set blocked_reason = 'vendor', blocked_since = now() where id = $1",
        [task.id],
      ),
    ).resolves.toBeDefined();
  });
});

describe("relation repository", () => {
  it("loads every edge touching a page once, with both endpoints", async () => {
    const a = await createTask("A");
    const b = await createTask("B");
    const c = await createTask("C");
    const ab = await insertRelation(a.id, b.id);
    const bc = await insertRelation(b.id, c.id, "related_to");
    const unitOfWork = createUnitOfWork(handle);

    const edges = await unitOfWork.execute((tx) =>
      tx.tasks.relationsFor(workspaceId, [a.id, c.id]),
    );

    expect(edges.map((edge) => edge.relation.id)).toEqual([ab, bc]);
    expect(edges[0]?.source.title).toBe("A");
    expect(edges[0]?.target.title).toBe("B");
    expect(edges[1]?.relation.type).toBe("related_to");
    await expect(
      unitOfWork.execute((tx) => tx.tasks.relationsFor(workspaceId, [])),
    ).resolves.toEqual([]);
  });

  it("walks the blocks graph downstream to a bounded depth", async () => {
    const a = await createTask("A");
    const b = await createTask("B");
    const c = await createTask("C");
    const d = await createTask("D");
    await insertRelation(a.id, b.id);
    await insertRelation(b.id, c.id);
    // Related-to edges are a different graph and must not be followed.
    await insertRelation(c.id, d.id, "related_to");
    const unitOfWork = createUnitOfWork(handle);

    const downstream = await unitOfWork.execute((tx) =>
      tx.tasks.downstreamOf(workspaceId, a.id, "blocks"),
    );
    expect([...downstream].sort()).toEqual([b.id, c.id].sort());
    await expect(
      unitOfWork.execute((tx) => tx.tasks.downstreamOf(workspaceId, d.id, "blocks")),
    ).resolves.toEqual([]);
  });

  it("inserts once, finds, and deletes a relation inside the workspace", async () => {
    const a = await createTask("A");
    const b = await createTask("B");
    const unitOfWork = createUnitOfWork(handle);
    const first = relation(a.id, b.id);

    await expect(
      unitOfWork.execute((tx) => tx.tasks.insertRelation(first)),
    ).resolves.toBe(true);
    await expect(
      unitOfWork.execute((tx) => tx.tasks.insertRelation(relation(a.id, b.id))),
    ).resolves.toBe(false);
    await expect(
      unitOfWork.execute((tx) => tx.tasks.findRelation(workspaceId, first.id)),
    ).resolves.toMatchObject({ id: first.id, type: "blocks" });

    await unitOfWork.execute((tx) => tx.tasks.deleteRelation(uuidv7(), first.id));
    await expect(
      unitOfWork.execute((tx) => tx.tasks.findRelation(workspaceId, first.id)),
    ).resolves.not.toBeNull();
    await unitOfWork.execute((tx) => tx.tasks.deleteRelation(workspaceId, first.id));
    await expect(
      unitOfWork.execute((tx) => tx.tasks.findRelation(workspaceId, first.id)),
    ).resolves.toBeNull();
  });

  it("filters by blocked state: a flag, or a live incomplete predecessor", async () => {
    const blocker = await createTask("Blocker");
    const waiting = await createTask("Waiting");
    const flagged = await createTask("Flagged");
    const doneBlocker = await createTask("Done blocker");
    const freed = await createTask("Freed");
    const trashedBlocker = await createTask("Trashed blocker");
    const orphaned = await createTask("Orphaned");
    await createTask("Plain");
    await insertRelation(blocker.id, waiting.id);
    await insertRelation(doneBlocker.id, freed.id);
    await insertRelation(trashedBlocker.id, orphaned.id);
    await handle.pool.query(
      "update tasks set blocked_reason = 'vendor', blocked_since = now() where id = $1",
      [flagged.id],
    );
    await tasks.complete(context, workspaceId, doneBlocker.id);
    await tasks.delete(context, workspaceId, trashedBlocker.id);

    const list = (isBlocked: boolean) =>
      tasks.list(context, {
        workspaceId,
        limit: 50,
        includeSubtasks: true,
        isBlocked,
        sort: "createdAt",
        order: "asc",
      } as never);

    expect((await list(true)).data.map((task) => task.title)).toEqual([
      "Waiting",
      "Flagged",
    ]);
    expect((await list(false)).data.map((task) => task.title)).toEqual([
      "Blocker",
      "Done blocker",
      "Freed",
      "Orphaned",
      "Plain",
    ]);
  });

  it("rolls back a relation with its activity and outbox rows", async () => {
    // EVT-001 for relations: a failure after the insert leaves no edge and no event.
    const a = await createTask("A");
    const b = await createTask("B");
    const unitOfWork = createUnitOfWork(handle);

    await expect(
      unitOfWork.execute(async (tx) => {
        await tx.tasks.insertRelation(relation(a.id, b.id));
        await tx.activity.append({
          id: uuidv7(),
          workspaceId,
          aggregateType: "task",
          aggregateId: a.id,
          eventType: "task.relation_added",
          actorKind: "user",
          actorId: context.actorId,
          actorDisplayName: null,
          summary: "never committed",
          payload: {},
          correlationId: "req_rollback",
          createdAt: NOW,
        });
        throw new Error("deliberate failure");
      }),
    ).rejects.toThrow("deliberate failure");

    const edges = await handle.pool.query("select id from task_relations");
    expect(edges.rows).toHaveLength(0);
    const added = await handle.pool.query(
      "select id from activity_events where event_type = 'task.relation_added'",
    );
    expect(added.rows).toHaveLength(0);
  });
});
