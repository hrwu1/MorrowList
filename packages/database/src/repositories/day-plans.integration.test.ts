import {
  TaskService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { fixedClock, uuidv7, type DayPlan, type PlainDate } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * My Day persistence against real PostgreSQL (TASK-007, spec 9.2): the composite key,
 * cascade on task deletion, the date-bound expiry of selections, and the one-query Today
 * and Upcoming reads that the 300 ms budget depends on.
 */

const NOW = new Date("2026-09-03T09:00:00.000Z");
const TODAY = "2026-09-03" as PlainDate;
const YESTERDAY = "2026-09-02" as PlainDate;
const TOMORROW = "2026-09-04" as PlainDate;

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let service: TaskService;
let context: ActorContext;
let workspaceId: string;

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
    { userId, email: "today@example.com", timezone: "UTC", taskKeyPrefix: "ML" },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspace.id],
    scopes: new Set(),
    requestId: "req_day_plans",
  };
  service = new TaskService({ unitOfWork, clock: fixedClock(NOW), cursorSecret: "s" });
});

function plan(
  taskId: string,
  planDate: PlainDate,
  source: DayPlan["source"] = "manual",
) {
  return {
    taskId,
    planDate,
    source,
    createdBy: { kind: "user", id: context.actorId },
    createdAt: NOW,
  } satisfies DayPlan;
}

async function createTask(title: string, dueDate?: PlainDate) {
  return service.create(context, {
    workspaceId,
    title,
    ...(dueDate ? { dueDate } : {}),
  });
}

describe("day plan composite key", () => {
  it("accepts one plan per task and date, and reports a duplicate without failing", async () => {
    const task = await createTask("Plan me");

    const results = await unitOfWork.execute(async (tx) => [
      await tx.dayPlans.insert(plan(task.id, TODAY)),
      await tx.dayPlans.insert(plan(task.id, TODAY)),
      await tx.dayPlans.insert(plan(task.id, TOMORROW)),
    ]);

    expect(results).toEqual([true, false, true]);
    const { rows } = await handle.pool.query(
      "select plan_date from task_day_plans where task_id = $1 order by plan_date",
      [task.id],
    );
    expect(rows).toHaveLength(2);
  });

  it("enforces the key at the database level", async () => {
    const task = await createTask("Raw duplicate");
    const insert = `insert into task_day_plans (task_id, plan_date, source,
        created_by_actor_kind, created_by_actor_id, created_at)
      values ($1, $2, 'manual', 'user', 'u', now())`;
    await handle.pool.query(insert, [task.id, TODAY]);

    await expect(handle.pool.query(insert, [task.id, TODAY])).rejects.toThrow(
      /task_day_plans_pk/,
    );
  });

  it("removes a plan and reports when there was none", async () => {
    const task = await createTask("Remove me");
    await unitOfWork.execute((tx) => tx.dayPlans.insert(plan(task.id, TODAY)));

    const results = await unitOfWork.execute(async (tx) => [
      await tx.dayPlans.delete(task.id, TODAY),
      await tx.dayPlans.delete(task.id, TODAY),
    ]);

    expect(results).toEqual([true, false]);
  });

  it("drops plans with the task row", async () => {
    const task = await createTask("Cascade");
    await unitOfWork.execute((tx) => tx.dayPlans.insert(plan(task.id, TODAY)));

    await unitOfWork.execute((tx) => tx.tasks.hardDelete(workspaceId, task.id));

    const { rows } = await handle.pool.query(
      "select 1 from task_day_plans where task_id = $1",
      [task.id],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("expiry by date", () => {
  it("lists only plans on or after the given date, ascending", async () => {
    const task = await createTask("Dated");
    await unitOfWork.execute(async (tx) => {
      await tx.dayPlans.insert(plan(task.id, TOMORROW));
      await tx.dayPlans.insert(plan(task.id, YESTERDAY));
      await tx.dayPlans.insert(plan(task.id, TODAY));
    });

    const plans = await unitOfWork.execute((tx) =>
      tx.dayPlans.listForTasks([task.id], TODAY),
    );

    // Yesterday's selection expired by the date passing; nothing deleted it.
    expect(plans.get(task.id)).toEqual([TODAY, TOMORROW]);
  });

  it("returns yesterday's open manual selections for the review, and nothing else", async () => {
    const open = await createTask("Still open");
    const finished = await createTask("Finished");
    const captured = await createTask("Captured");
    await unitOfWork.execute(async (tx) => {
      await tx.dayPlans.insert(plan(open.id, YESTERDAY));
      await tx.dayPlans.insert(plan(finished.id, YESTERDAY));
      await tx.dayPlans.insert(plan(captured.id, YESTERDAY, "capture"));
    });
    await service.complete(context, workspaceId, finished.id);

    const unfinished = await unitOfWork.execute((tx) =>
      tx.dayPlans.listUnfinished(workspaceId, YESTERDAY),
    );

    expect(unfinished.map((task) => task.id)).toEqual([open.id]);
  });
});

describe("Today and Upcoming reads", () => {
  it("reads overdue, due-today, and planned tasks in one bounded query", async () => {
    const overdue = await createTask("Overdue", YESTERDAY);
    const dueToday = await createTask("Due today", TODAY);
    const planned = await createTask("Planned");
    const plannedYesterday = await createTask("Planned yesterday");
    const future = await createTask("Future", TOMORROW);
    const done = await createTask("Done", TODAY);
    await createTask("Unplanned");
    await unitOfWork.execute(async (tx) => {
      await tx.dayPlans.insert(plan(planned.id, TODAY));
      await tx.dayPlans.insert(plan(plannedYesterday.id, YESTERDAY));
      await tx.dayPlans.insert(plan(future.id, TOMORROW));
    });
    await service.complete(context, workspaceId, done.id);

    const page = await unitOfWork.execute((tx) =>
      tx.tasks.listToday({ workspaceId, date: TODAY }),
    );

    expect(page.items.map((task) => task.id)).toEqual([
      overdue.id,
      dueToday.id,
      planned.id,
    ]);
    expect(page.truncated).toBe(false);
  });

  it("reads future tasks within an inclusive horizon, ordered by due date", async () => {
    await createTask("Today", TODAY);
    const soon = await createTask("Soon", TOMORROW);
    const edge = await createTask("Edge", "2026-09-17" as PlainDate);
    const beyond = await createTask("Beyond", "2026-09-18" as PlainDate);

    const bounded = await unitOfWork.execute((tx) =>
      tx.tasks.listUpcoming({
        workspaceId,
        from: TODAY,
        to: "2026-09-17" as PlainDate,
      }),
    );
    const open = await unitOfWork.execute((tx) =>
      tx.tasks.listUpcoming({ workspaceId, from: TODAY, to: null }),
    );

    expect(bounded.items.map((task) => task.id)).toEqual([soon.id, edge.id]);
    expect(open.items.map((task) => task.id)).toEqual([soon.id, edge.id, beyond.id]);
  });

  it("stays under the Today budget with ten thousand tasks", async () => {
    // Completion criterion: one API call, under 300 ms p95 at 10k tasks. The bulk insert
    // spreads due dates so the day's slice is realistic rather than empty or everything.
    await handle.pool.query(
      `insert into tasks (id, workspace_id, task_number, title, rank, due_date, priority,
         version, created_by_actor_kind, created_by_actor_id, last_actor_kind,
         last_actor_id, created_at, updated_at)
       select gen_random_uuid(), $1, 1000 + n, 'Task ' || n, lpad(n::text, 6, '0'),
         case when n % 10 = 0 then $2::date + (n % 60) - 30 else null end,
         'none', 1, 'user', 'u', 'user', 'u', now(), now()
       from generate_series(1, 10000) as n`,
      [workspaceId, TODAY],
    );
    await handle.pool.query(
      `insert into task_day_plans (task_id, plan_date, source, created_by_actor_kind,
         created_by_actor_id, created_at)
       select id, $2, 'manual', 'user', 'u', now() from tasks
       where workspace_id = $1 and task_number % 100 = 0`,
      [workspaceId, TODAY],
    );

    const started = performance.now();
    const page = await unitOfWork.execute((tx) =>
      tx.tasks.listToday({ workspaceId, date: TODAY }),
    );
    const elapsed = performance.now() - started;

    expect(page.items.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(300);
  });
});
