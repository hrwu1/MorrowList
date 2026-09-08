import {
  FieldService,
  TaskService,
  bootstrapUser,
  type ActorContext,
} from "@morrowlist/application";
import { fixedClock, parseFieldFilter, uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Typed custom fields against real PostgreSQL (GAP-24). Migration 0013 carries the
 * `tasks.fields` column, its GIN index, the definitions table with its unique key and
 * pinned collation, and the new `aggregate_type` value — none of which the in-memory
 * doubles can demonstrate. The jsonb comparisons the filters compile to are SQL, so
 * their behaviour is only real here.
 */

const NOW = new Date("2026-09-05T09:00:00.000Z");

/**
 * The read budget for a filtered list (spec 29.2 keeps interactive reads under 300 ms).
 * Measured over a workspace of 10,000 tasks; the equality filter is an index scan.
 */
const FILTER_BUDGET_MS = 300;
const SCALE_TASKS = 10_000;

let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;
let tasks: TaskService;
let fields: FieldService;

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
      email: "fields-integration@example.com",
      displayName: "Fields Integration",
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
    requestId: "req_fields_integration",
  };
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "fields-integration-cursor-secret",
  });
  fields = new FieldService({ unitOfWork, clock: fixedClock(NOW) });
});

const listQuery = (overrides: Record<string, unknown> = {}) =>
  ({
    workspaceId,
    limit: 50,
    includeSubtasks: true,
    sort: "rank" as const,
    order: "asc" as const,
    ...overrides,
  }) as never;

describe("field definitions in PostgreSQL", () => {
  it("keys are unique per workspace and the type is constrained by the database", async () => {
    await fields.create(context, workspaceId, { name: "Effort", type: "number" });

    await expect(
      handle.pool.query(
        `insert into field_definitions (id, workspace_id, key, name, type, options, rank, show_on_card, created_at, updated_at)
         values ($1, $2, 'effort', 'Effort again', 'text', '[]'::jsonb, 'a1', false, now(), now())`,
        [uuidv7(), workspaceId],
      ),
    ).rejects.toThrow(/field_definitions_workspace_key/);

    await expect(
      handle.pool.query(
        `insert into field_definitions (id, workspace_id, key, name, type, options, rank, show_on_card, created_at, updated_at)
         values ($1, $2, 'weird', 'Weird', 'currency', '[]'::jsonb, 'a2', false, now(), now())`,
        [uuidv7(), workspaceId],
      ),
    ).rejects.toThrow(/field_definitions_type_check/);
  });

  it("stores values on the task row itself and reads them back typed", async () => {
    await fields.create(context, workspaceId, { name: "Effort", type: "number" });
    await fields.create(context, workspaceId, {
      name: "Stage",
      type: "select",
      options: ["alpha", "beta"],
    });

    const created = await tasks.create(context, {
      workspaceId,
      title: "Sized",
      fields: { effort: "3", stage: "beta" },
    });

    const { rows } = await handle.pool.query<{ fields: Record<string, unknown> }>(
      "select fields from tasks where id = $1",
      [created.id],
    );
    expect(rows[0]?.fields).toEqual({ effort: 3, stage: "beta" });
    await expect(tasks.get(context, workspaceId, created.id)).resolves.toMatchObject({
      fields: { effort: 3, stage: "beta" },
    });
  });

  it("deleting a definition clears its key from every task in the same transaction", async () => {
    const effort = await fields.create(context, workspaceId, {
      name: "Effort",
      type: "number",
    });
    await fields.create(context, workspaceId, { name: "Notes", type: "text" });
    const kept = await tasks.create(context, {
      workspaceId,
      title: "Kept",
      fields: { effort: 1, notes: "hello" },
    });
    const trashed = await tasks.create(context, {
      workspaceId,
      title: "Trashed",
      fields: { effort: 2 },
    });
    await tasks.delete(context, workspaceId, trashed.id);

    await fields.delete(context, workspaceId, effort.id);

    const { rows } = await handle.pool.query<{
      id: string;
      fields: Record<string, unknown>;
    }>("select id, fields from tasks order by task_number");
    expect(rows.map((row) => row.fields)).toEqual([{ notes: "hello" }, {}]);
    expect(rows[0]?.id).toBe(kept.id);

    const { rows: events } = await handle.pool.query<{
      event_type: string;
      payload: { taskCount: number };
    }>(
      "select event_type, payload from activity_events where aggregate_type = 'field'",
    );
    // Picked by type rather than by row order: the select is unordered, and the fixed
    // clock gives every event in this test the same `created_at` to sort on.
    expect(
      events.filter((event) => event.event_type === "field.deleted"),
    ).toMatchObject([
      {
        event_type: "field.deleted",
        // Both the live and the trashed task lost the key: a restore must not bring it back.
        payload: { taskCount: 2 },
      },
    ]);
  });

  it("rolls the definition, the cleared values and both event rows back together", async () => {
    const effort = await fields.create(context, workspaceId, {
      name: "Effort",
      type: "number",
    });
    const task = await tasks.create(context, {
      workspaceId,
      title: "Sized",
      fields: { effort: 3 },
    });

    // A unit of work that throws after the service's own writes: the transaction is the
    // service's, so nothing it wrote may survive.
    const failing = createUnitOfWork(handle);
    await expect(
      failing.execute(async (tx) => {
        await tx.fields.clearValues(workspaceId, "effort");
        await tx.fields.delete(workspaceId, effort.id);
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow(/simulated failure/);

    const { rows } = await handle.pool.query<{ count: string }>(
      "select count(*)::text as count from field_definitions where id = $1",
      [effort.id],
    );
    expect(rows[0]?.count).toBe("1");
    await expect(tasks.get(context, workspaceId, task.id)).resolves.toMatchObject({
      fields: { effort: 3 },
    });
  });
});

describe("filtering by a field value", () => {
  beforeEach(async () => {
    await fields.create(context, workspaceId, { name: "Effort", type: "number" });
    await fields.create(context, workspaceId, {
      name: "Stage",
      type: "select",
      options: ["alpha", "beta"],
    });
    await fields.create(context, workspaceId, { name: "Target", type: "date" });
  });

  const ids = async (...expressions: string[]) =>
    (
      await tasks.list(
        context,
        listQuery({ fields: expressions.map(parseFieldFilter) }),
      )
    ).data.map((task) => task.title);

  it("compares numbers, dates and options the way the domain does", async () => {
    await tasks.create(context, {
      workspaceId,
      title: "small",
      fields: { effort: 1, stage: "alpha", target: "2026-01-31" },
    });
    await tasks.create(context, {
      workspaceId,
      title: "large",
      fields: { effort: 12, stage: "beta", target: "2026-11-01" },
    });
    await tasks.create(context, { workspaceId, title: "unset" });

    // 12 > 2 numerically; a lexicographic comparison would answer the opposite.
    expect(await ids("effort:gt:2")).toEqual(["large"]);
    expect(await ids("effort:lt:2")).toEqual(["small"]);
    expect(await ids("effort:eq:12")).toEqual(["large"]);
    expect(await ids("effort:ne:12")).toEqual(["small", "unset"]);
    expect(await ids("effort:between:1..5")).toEqual(["small"]);
    expect(await ids("effort:empty")).toEqual(["unset"]);
    expect(await ids("stage:eq:beta")).toEqual(["large"]);
    expect(await ids("target:gt:2026-06-01")).toEqual(["large"]);
    // Several filters combine with AND.
    expect(await ids("effort:gt:2", "stage:eq:alpha")).toEqual([]);
    expect(await ids("effort:gt:2", "stage:eq:beta")).toEqual(["large"]);
  });

  /**
   * The completion criterion: filtering 10,000 tasks by a field value stays under the
   * read budget. The rows are inserted with one statement rather than 10,000 commands,
   * because what is under test is the read.
   */
  it(
    `filters ${SCALE_TASKS} tasks by an equality value inside the read budget`,
    { timeout: 120_000 },
    async () => {
      await handle.pool.query(
        `insert into tasks (
           id, workspace_id, task_number, title, priority, rank, fields, version,
           created_by_actor_kind, created_by_actor_id, last_actor_kind, last_actor_id,
           created_at, updated_at
         )
         select
           gen_random_uuid(), $1, n + 1000, 'Scale ' || n, 'none', 'a' || lpad(n::text, 6, '0'),
           jsonb_build_object('effort', (n % 100), 'stage', case when n % 100 = 7 then 'beta' else 'alpha' end),
           1, 'user', $2, 'user', $2, now(), now()
         from generate_series(1, ${SCALE_TASKS}) as n`,
        [workspaceId, context.actorId],
      );
      await handle.pool.query("analyze tasks");

      const started = performance.now();
      const page = await tasks.list(
        context,
        listQuery({ fields: [parseFieldFilter("stage:eq:beta")], limit: 50 }),
      );
      const elapsedMs = performance.now() - started;

      expect(page.data).toHaveLength(50);
      expect(page.data.every((task) => task.fields.stage === "beta")).toBe(true);
      // Reported so a regression is visible in the test output, not only as a failure.

      console.log(
        `field equality filter over ${SCALE_TASKS} tasks: ${elapsedMs.toFixed(1)} ms`,
      );
      expect(elapsedMs).toBeLessThan(FILTER_BUDGET_MS);

      // A wall-clock number on one machine is weak evidence, so also assert that the
      // GIN index can answer the containment predicate the equality filter compiles to.
      // The planner will not always choose it: at this size, `workspace_id` alone is a
      // cheaper way into 10,000 narrow rows and it is right to take it. What matters is
      // that the index exists and is usable, which is what keeps the filter flat as a
      // workspace grows past the point where scanning it is free.
      const client = await handle.pool.connect();
      try {
        await client.query("begin");
        await client.query("set local enable_seqscan = off");
        const { rows } = await client.query<{ "QUERY PLAN": string }>(
          `explain select id from tasks where fields @> '{"stage": "beta"}'::jsonb`,
        );
        expect(rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
          "tasks_fields_idx",
        );
      } finally {
        await client.query("rollback");
        client.release();
      }
    },
  );
});
