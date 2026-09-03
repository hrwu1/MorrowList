import { describe, expect, it } from "vitest";

import { DEFAULT_WORKFLOW, type WorkflowStatus } from "../project/status.js";

import { TEST_INSTANT, testActor } from "./fixtures.js";
import type { Task } from "./task.js";
import {
  entersInProgress,
  inProgressCount,
  inProgressTasks,
  normalizeInProgressLimit,
  wipWarning,
} from "./wip.js";

function workflow(projectId: string): WorkflowStatus[] {
  return DEFAULT_WORKFLOW.map((template, index) => ({
    id: `${projectId}-${template.category}`,
    projectId,
    name: template.name,
    category: template.category,
    rank: String.fromCharCode(97 + index),
    colorToken: template.colorToken,
    wipLimit: null,
    isDefault: template.isDefault,
    policyMd: null,
    archivedAt: null,
    version: 1,
  }));
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: "workspace-1",
    taskNumber: 1,
    projectId: "alpha",
    statusId: "alpha-ready",
    title: "Task",
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    parentTaskId: null,
    rank: "a0",
    lastActiveStatusId: null,
    completedAt: null,
    version: 1,
    createdBy: testActor,
    lastActor: testActor,
    createdAt: TEST_INSTANT,
    updatedAt: TEST_INSTANT,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

const alpha = workflow("alpha");
const beta = workflow("beta");
const statuses = [...alpha, ...beta];

describe("inProgressCount", () => {
  it("counts open tasks in in-progress columns across projects", () => {
    const tasks = [
      buildTask({ projectId: "alpha", statusId: "alpha-in_progress" }),
      buildTask({ projectId: "beta", statusId: "beta-in_progress" }),
      buildTask({ projectId: "alpha", statusId: "alpha-ready" }),
      buildTask({ projectId: null, statusId: null }),
    ];
    expect(inProgressCount(tasks, statuses)).toBe(2);
    expect(inProgressTasks(tasks, statuses).map((task) => task.projectId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("ignores trashed, completed, and archived-column tasks", () => {
    const archived = alpha.map((status) =>
      status.category === "in_progress"
        ? { ...status, archivedAt: new Date("2026-09-01T00:00:00.000Z") }
        : status,
    );
    const tasks = [
      buildTask({ statusId: "alpha-in_progress", deletedAt: new Date() }),
      buildTask({ statusId: "beta-in_progress", completedAt: new Date() }),
      buildTask({ statusId: "alpha-in_progress" }),
    ];
    expect(inProgressCount(tasks, [...archived, ...beta])).toBe(0);
  });
});

describe("wipWarning", () => {
  it("is null without a limit or within it, and names the excess otherwise", () => {
    expect(wipWarning(5, null)).toBeNull();
    expect(wipWarning(3, 3)).toBeNull();
    expect(wipWarning(4, 3)).toEqual({
      code: "IN_PROGRESS_LIMIT_EXCEEDED",
      limit: 3,
      count: 4,
    });
  });
});

describe("entersInProgress", () => {
  const ready = alpha.find((status) => status.category === "ready") as WorkflowStatus;
  const doing = alpha.find(
    (status) => status.category === "in_progress",
  ) as WorkflowStatus;
  const doingElsewhere = beta.find(
    (status) => status.category === "in_progress",
  ) as WorkflowStatus;

  it("is true only when the destination is in progress and the origin was not", () => {
    expect(entersInProgress(ready, doing)).toBe(true);
    expect(entersInProgress(null, doing)).toBe(true);
    expect(entersInProgress(doing, doingElsewhere)).toBe(false);
    expect(entersInProgress(doing, ready)).toBe(false);
    expect(entersInProgress(ready, null)).toBe(false);
  });
});

describe("normalizeInProgressLimit", () => {
  it("accepts null and positive integers only", () => {
    expect(normalizeInProgressLimit(null)).toBeNull();
    expect(normalizeInProgressLimit(3)).toBe(3);
    expect(() => normalizeInProgressLimit(0)).toThrow(/positive whole number/);
    expect(() => normalizeInProgressLimit(1.5)).toThrow(/positive whole number/);
  });
});
