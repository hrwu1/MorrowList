import {
  TagService,
  TaskService,
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
 * Recurring tasks against real PostgreSQL (GAP-12). Migration 0006 adds the JSONB rule
 * and the series column with its index; the spawn on completion must be one transaction
 * with the completion itself, which only a real database can demonstrate.
 */

// Saturday in UTC and in the workspace timezone.
const NOW = new Date("2026-08-29T09:00:00.000Z");
const CURSOR_SECRET = "integration-cursor-secret";

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;

const weekly = {
  freq: "weekly" as const,
  interval: 1,
  mode: "schedule" as const,
  weekdays: ["sat" as const],
  monthDay: null,
  nthWeekday: null,
  until: null,
  count: null,
};

function taskService(uow: UnitOfWork = unitOfWork): TaskService {
  return new TaskService({
    unitOfWork: uow,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
}

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
      email: "recurrence-integration@example.com",
      displayName: "Recurrence Integration",
      timezone: "UTC",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Recurrence Integration",
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_recurrence",
  };
});

describe("migration 0006", () => {
  it("adds the rule column, the series column, and the series index", async () => {
    const columns = await handle.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_name = 'tasks' and column_name in ('recurrence', 'series_id')
       order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "recurrence", data_type: "jsonb" },
      { column_name: "series_id", data_type: "uuid" },
    ]);

    const indexes = await handle.pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename = 'tasks' and indexname = 'tasks_series_idx'",
    );
    expect(indexes.rows[0]?.indexdef).toContain("(workspace_id, series_id)");
  });

  it("round-trips a rule through JSONB regardless of key order", async () => {
    const service = taskService();
    const created = await service.create(context, {
      workspaceId,
      title: "Water plants",
      dueDate: "2026-08-29",
      recurrence: {
        ...weekly,
        weekdays: ["thu", "sat"],
        nthWeekday: null,
        until: "2026-12-31",
        count: 4,
      },
    });

    const loaded = await service.get(context, workspaceId, created.key);
    expect(loaded.recurrence).toEqual({
      ...weekly,
      weekdays: ["thu", "sat"],
      until: "2026-12-31",
      count: 4,
    });
    expect(loaded.seriesId).toBe(created.id);

    // Re-saving the same rule is not a change: JSONB reorders keys, the domain does not care.
    const same = await service.update(context, workspaceId, created.id, {
      recurrence: {
        ...weekly,
        weekdays: ["thu", "sat"],
        until: "2026-12-31",
        count: 4,
      },
    });
    expect(same.version).toBe(1);
  });
});

describe("completion of a repeating task", () => {
  it("creates the next occurrence with tags and both event rows in the same transaction", async () => {
    const service = taskService();
    const tags = new TagService({ unitOfWork, clock: fixedClock(NOW) });
    const focus = await tags.create(context, workspaceId, { name: "Focus" });
    const first = await service.create(context, {
      workspaceId,
      title: "Weekly review",
      dueDate: "2026-08-29",
      recurrence: weekly,
    });
    await service.addTag(context, workspaceId, first.id, focus.id);

    const completed = await service.complete(context, workspaceId, first.id);
    expect(completed.recurrence).toBeNull();

    const series = await service.list(context, {
      workspaceId,
      seriesId: first.id,
      limit: 50,
      includeSubtasks: true,
      sort: "dueDate",
      order: "asc",
    });
    expect(
      series.data.map((task) => [task.key, task.dueDate, task.isCompleted]),
    ).toEqual([
      ["ML-000001", "2026-08-29", true],
      ["ML-000002", "2026-09-05", false],
    ]);
    expect(series.data[1]?.tags.map((tag) => tag.name)).toEqual(["Focus"]);
    expect(series.data[1]?.recurrence).toEqual(weekly);

    const events = await handle.pool.query<{
      event_type: string;
      aggregate_id: string;
    }>(
      `select event_type, aggregate_id from activity_events
       where event_type in ('task.created', 'task.completed') order by created_at, id`,
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "task.created",
      "task.created",
      "task.completed",
    ]);
    const outbox = await handle.pool.query<{ event_type: string }>(
      "select event_type from outbox_events where aggregate_id = $1",
      [series.data[1]?.id],
    );
    expect(outbox.rows.map((row) => row.event_type)).toEqual(["task.created"]);
  });

  it("rolls the completion back with the spawned occurrence when the transaction fails after the spawn", async () => {
    const first = await taskService().create(context, {
      workspaceId,
      title: "Atomic",
      dueDate: "2026-08-29",
      recurrence: weekly,
    });
    const before = await handle.pool.query(
      "select count(*)::int as n from activity_events",
    );

    // Everything the command does runs inside the callback; failing after it has returned
    // aborts the transaction after the completion, the spawn, and every event row.
    const failing: UnitOfWork = {
      execute: (fn) =>
        unitOfWork.execute(async (tx) => {
          await fn(tx);
          throw new Error("deliberate failure after the spawn");
        }),
    };

    await expect(
      taskService(failing).complete(context, workspaceId, first.id),
    ).rejects.toThrow("deliberate failure after the spawn");

    const tasks = await handle.pool.query<{
      id: string;
      completed_at: Date | null;
      version: number;
      recurrence: unknown;
    }>("select id, completed_at, version, recurrence from tasks");
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]).toMatchObject({
      id: first.id,
      completed_at: null,
      version: 1,
    });
    expect(tasks.rows[0]?.recurrence).toEqual(weekly);
    const after = await handle.pool.query(
      "select count(*)::int as n from activity_events",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
