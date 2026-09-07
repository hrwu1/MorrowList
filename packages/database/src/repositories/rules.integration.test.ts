import {
  bootstrapUser,
  RuleService,
  ProjectService,
  RuleEngine,
  TaskService,
  TagService,
  WebhookService,
  WebhookDispatcher,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";
const now = new Date("2026-09-07T03:30:00Z");
const clock = fixedClock(now);
let handle: DatabaseHandle;
let uow: UnitOfWork;
let actor: ActorContext;
let workspaceId: string;
let tasks: TaskService;
let rules: RuleService;
let engine: RuleEngine;
beforeAll(async () => {
  handle = await setupTestDatabase();
});
afterAll(teardownTestDatabase);
beforeEach(async () => {
  await truncateAll(handle);
  uow = createUnitOfWork(handle);
  const userId = uuidv7();
  const boot = await bootstrapUser(
    { unitOfWork: uow, clock },
    {
      userId,
      email: "rules@example.com",
      displayName: "Rules",
      timezone: "America/New_York",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = boot.workspace.id;
  actor = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "rules-integration",
  };
  tasks = new TaskService({ unitOfWork: uow, clock, cursorSecret: "rules-test" });
  rules = new RuleService({ unitOfWork: uow, clock });
  engine = new RuleEngine({ unitOfWork: uow, clock });
});
const create = (
  actions: Parameters<RuleService["create"]>[2]["actions"],
  trigger: Parameters<RuleService["create"]>[2]["trigger"] = { type: "task.created" },
) =>
  rules.create(actor, workspaceId, {
    name: "Automation",
    trigger,
    conditions: [],
    actions,
    enabled: true,
  });
describe("transactional automation", () => {
  it("stops mutually triggering project moves after the user event", async () => {
    const projects = new ProjectService({ unitOfWork: uow, clock });
    const first = await projects.create(actor, { workspaceId, name: "First" });
    const second = await projects.create(actor, { workspaceId, name: "Second" });
    await create([{ type: "move_to", projectId: first.project.id }], {
      type: "task.moved",
    });
    await create([{ type: "move_to", projectId: second.project.id }], {
      type: "task.moved",
    });
    const task = await tasks.create(actor, { workspaceId, title: "Move" });
    await tasks.move(actor, workspaceId, task.id, { projectId: first.project.id });
    expect(await engine.tick()).toBe(2);
    expect(await engine.tick()).toBe(0);
    expect(
      (await handle.pool.query("select count(*) from rule_runs")).rows[0].count,
    ).toBe("2");
  });

  it("rolls back rule configuration with its activity and outbox", async () => {
    const before = await handle.pool.query("select count(*) from activity_events");
    const failing = new RuleService({
      clock,
      unitOfWork: {
        execute: (fn) =>
          uow.execute(async (tx) => {
            await fn(tx);
            throw new Error("failed commit");
          }),
      },
    });
    await expect(
      failing.create(actor, workspaceId, {
        name: "Rolled back",
        trigger: { type: "task.created" },
        conditions: [],
        actions: [{ type: "complete" }],
        enabled: true,
      }),
    ).rejects.toThrow("failed commit");
    expect((await rules.list(actor, workspaceId)).data).toHaveLength(0);
    expect(
      (await handle.pool.query("select count(*) from activity_events")).rows,
    ).toEqual(before.rows);
  });
  it("rejects an existing tag from another workspace without writing a rule", async () => {
    const userId = uuidv7();
    const other = await bootstrapUser(
      { unitOfWork: uow, clock },
      {
        userId,
        email: "other-rules@example.com",
        displayName: "Other",
        timezone: "UTC",
        taskKeyPrefix: "OT",
      },
    );
    const otherActor = {
      ...actor,
      actorId: userId,
      userId,
      workspaceIds: [other.workspace.id],
    };
    const tag = await new TagService({ unitOfWork: uow, clock }).create(
      otherActor,
      other.workspace.id,
      { name: "private" },
    );
    await expect(create([{ type: "add_tag", tagId: tag.id }])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect((await rules.list(actor, workspaceId)).data).toHaveLength(0);
  });

  it("two workers claim a published source event only once and attribute activity", async () => {
    const rule = await create([{ type: "set_priority", priority: "urgent" }]);
    const task = await tasks.create(actor, { workspaceId, title: "task" });
    await handle.pool.query("update outbox_events set published_at = $1", [now]);
    const results = await Promise.all([
      engine.tick(),
      new RuleEngine({ unitOfWork: uow, clock }).tick(),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    const stored = await uow.execute((tx) => tx.tasks.findById(workspaceId, task.id));
    expect(stored?.priority).toBe("urgent");
    const activity = await handle.pool.query(
      "select actor_display_name from activity_events where actor_id = $1",
      [`rule:${rule.id}`],
    );
    expect(activity.rows).toEqual([{ actor_display_name: "Rule: Automation" }]);
    expect((await rules.runs(actor, workspaceId, rule.id)).data).toHaveLength(1);
    expect(await engine.tick()).toBe(0);
  });
  it("rolls back earlier actions and event rows on a later action failure", async () => {
    const rule = await create([
      { type: "set_priority", priority: "urgent" },
      { type: "complete" },
    ]);
    const task = await tasks.create(actor, { workspaceId, title: "blocked" });
    await tasks.setBlocked(actor, workspaceId, task.id, { reason: "Waiting" });
    const before = await handle.pool.query("select count(*) from activity_events");
    expect(await engine.tick()).toBe(0);
    expect(
      (await uow.execute((tx) => tx.tasks.findById(workspaceId, task.id)))?.priority,
    ).toBe("none");
    expect(
      (await handle.pool.query("select count(*) from activity_events")).rows,
    ).toEqual(before.rows);
    expect((await rules.runs(actor, workspaceId, rule.id)).data[0]).toMatchObject({
      status: "failed",
    });
    expect(
      (
        await handle.pool.query(
          "select count(*) from outbox_events where actor->>'id' = $1",
          [`rule:${rule.id}`],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  it("terminates mutually triggering rules and daily events use local dates", async () => {
    await create([{ type: "set_priority", priority: "high" }], {
      type: "task.updated",
    });
    await create([{ type: "set_priority", priority: "low" }], { type: "task.updated" });
    const task = await tasks.create(actor, {
      workspaceId,
      title: "task",
      dueDate: "2026-09-06",
    });
    await tasks.update(actor, workspaceId, task.id, { title: "changed" });
    expect(await engine.tick()).toBe(2);
    expect(await engine.tick()).toBe(0);
    const daily = await create([{ type: "add_to_day" }], { type: "due.today" });
    expect(await engine.tick()).toBe(1);
    expect(await engine.tick()).toBe(0);
    expect((await rules.runs(actor, workspaceId, daily.id)).data[0]?.eventKey).toBe(
      `due:${task.id}:2026-09-06`,
    );
  });
  it("rejects foreign targets, excludes pre-rule history, and re-enable starts fresh", async () => {
    const task = await tasks.create(actor, { workspaceId, title: "old" });
    const later = new RuleService({
      unitOfWork: uow,
      clock: fixedClock(new Date(now.getTime() + 1000)),
    });
    const rule = await later.create(actor, workspaceId, {
      name: "Fresh",
      trigger: { type: "task.created" },
      conditions: [],
      actions: [{ type: "complete" }],
      enabled: true,
    });
    expect(await engine.tick(new Date(now.getTime() + 1000))).toBe(0);
    await expect(create([{ type: "add_tag", tagId: uuidv7() }])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await later.update(actor, workspaceId, rule.id, { enabled: false });
    await tasks.create(actor, { workspaceId, title: "disabled" });
    await later.update(actor, workspaceId, rule.id, { enabled: true });
    expect(await engine.tick(new Date(now.getTime() + 1000))).toBe(0);
    expect(
      (await uow.execute((tx) => tx.tasks.findById(workspaceId, task.id)))?.completedAt,
    ).toBeNull();
    await expect(
      rules.runs({ ...actor, workspaceIds: [] }, workspaceId, rule.id),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
  it("queues webhook action atomically and reuses signed delivery dispatcher", async () => {
    const sent: unknown[] = [];
    const sender = {
      async send(request: unknown) {
        sent.push(request);
        return { status: 200, error: null };
      },
    };
    const webhooks = new WebhookService({
      unitOfWork: uow,
      sender,
      clock,
      cursorSecret: "rules-test",
    });
    const endpoint = await webhooks.create(actor, workspaceId, {
      url: "https://example.com/hook",
      eventTypes: ["rule.only"],
    });
    const task = await tasks.create(actor, { workspaceId, title: "hook" });
    await create([{ type: "call_webhook", subscriptionId: endpoint.id }], {
      type: "task.completed",
    });
    await new WebhookDispatcher({ unitOfWork: uow, sender, clock }).tick();
    expect(sent).toHaveLength(0);
    await tasks.complete(actor, workspaceId, task.id);
    expect(await engine.tick()).toBe(1);
    expect(sent).toHaveLength(0);
    await new WebhookDispatcher({ unitOfWork: uow, sender, clock }).tick();
    expect(sent).toHaveLength(1);
    expect(await engine.tick()).toBe(0);
    expect(
      (await webhooks.listDeliveries(actor, workspaceId, endpoint.id, { limit: 50 }))
        .data[0]?.status,
    ).toBe("delivered");
  });
});
