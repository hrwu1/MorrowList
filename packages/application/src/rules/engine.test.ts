import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  buildWorkspace,
  buildActorContext,
} from "../testing/index.js";

import { RuleEngine } from "./engine.js";
import { RuleService } from "./service.js";
const now = new Date("2026-09-07T03:30:00Z");
const clock = fixedClock(now);
let uow = createInMemoryUnitOfWork();
const workspace = buildWorkspace({ timezone: "America/New_York" });
const actor = buildActorContext({ workspaceIds: [workspace.id] });
let rules: RuleService;
let engine: RuleEngine;
let tasks: TaskService;
beforeEach(() => {
  const data = emptyData();
  data.workspaces.set(workspace.id, workspace);
  uow = createInMemoryUnitOfWork(data);
  rules = new RuleService({ unitOfWork: uow, clock });
  engine = new RuleEngine({ unitOfWork: uow, clock });
  tasks = new TaskService({ unitOfWork: uow, clock, cursorSecret: "test" });
});
describe("rule engine", () => {
  it("runs after commit, once, with activity attribution and loop guard across two rules", async () => {
    const first = await rules.create(actor, workspace.id, {
      name: "High",
      trigger: { type: "task.updated" },
      conditions: [],
      actions: [{ type: "set_priority", priority: "high" }],
      enabled: true,
    });
    await rules.create(actor, workspace.id, {
      name: "Low",
      trigger: { type: "task.updated" },
      conditions: [],
      actions: [{ type: "set_priority", priority: "low" }],
      enabled: true,
    });
    const task = await tasks.create(actor, {
      workspaceId: workspace.id,
      title: "task",
    });
    await tasks.update(actor, workspace.id, task.id, { title: "changed" });
    expect(uow.data.tasks.get(task.id)?.priority).toBe("none");
    expect(await engine.tick()).toBe(2);
    expect(await engine.tick()).toBe(0);
    expect(uow.data.ruleRuns.size).toBe(2);
    expect(
      uow.data.activity.some((event) => event.actorDisplayName === "Rule: High"),
    ).toBe(true);
    expect(
      uow.data.outbox
        .filter((event) => event.actor.id === `rule:${first.id}`)
        .every((event) => Boolean(event.causationId)),
    ).toBe(true);
  });
  it("daily trigger uses workspace date and records one run per task/day", async () => {
    await rules.create(actor, workspace.id, {
      name: "Today",
      trigger: { type: "due.today" },
      conditions: [],
      actions: [{ type: "add_to_day" }],
      enabled: true,
    });
    await tasks.create(actor, {
      workspaceId: workspace.id,
      title: "today",
      dueDate: "2026-09-06",
    });
    expect(await engine.tick()).toBe(1);
    expect(await engine.tick()).toBe(0);
    expect([...uow.data.dayPlans.values()][0]?.planDate).toBe("2026-09-06");
  });
  it("test is read-only, handles missing/foreign resources and scope", async () => {
    const rule = await rules.create(actor, workspace.id, {
      name: "Preview",
      trigger: { type: "task.created" },
      conditions: [],
      actions: [{ type: "complete" }],
      enabled: true,
    });
    const task = await tasks.create(actor, {
      workspaceId: workspace.id,
      title: "preview",
    });
    expect((await rules.test(actor, workspace.id, rule.id, task.id)).matches).toBe(
      true,
    );
    expect(uow.data.tasks.get(task.id)?.completedAt).toBeNull();
    expect(uow.data.ruleRuns.size).toBe(0);
    await expect(
      rules.list({ ...actor, workspaceIds: [] }, workspace.id),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(
      rules.create(
        { ...actor, actorKind: "api_key", scopes: new Set(["workspace:write"]) },
        workspace.id,
        {
          name: "Bad",
          trigger: { type: "task.created" },
          conditions: [],
          actions: [{ type: "complete" }],
          enabled: true,
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});
