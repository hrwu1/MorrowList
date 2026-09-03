import { describe, expect, it } from "vitest";

import type { DomainError } from "../shared/errors.js";

import { testContext } from "./fixtures.js";
import { completeTask, createTask, deleteTask, flagBlocked } from "./policies.js";
import {
  assertNoBlocksCycle,
  canonicalizeRelation,
  isBlocked,
  isRelationType,
  normalizeBlockedReason,
} from "./relation.js";
import type { Task } from "./task.js";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    ...createTask(
      { id, workspaceId: "workspace-1", taskNumber: 1, title: id, rank: "a0" },
      testContext(),
    ),
    ...overrides,
  };
}

describe("canonicalizeRelation", () => {
  it("keeps the direction of blocks and orders related_to by id", () => {
    const a = task("a");
    const b = task("b");

    expect(canonicalizeRelation("blocks", b, a)).toEqual({
      sourceTaskId: "b",
      targetTaskId: "a",
    });
    expect(canonicalizeRelation("related_to", b, a)).toEqual({
      sourceTaskId: "a",
      targetTaskId: "b",
    });
    expect(canonicalizeRelation("related_to", a, b)).toEqual({
      sourceTaskId: "a",
      targetTaskId: "b",
    });
  });

  it("rejects a self relation, another workspace, and a target in the Trash", () => {
    const a = task("a");

    expect(() => canonicalizeRelation("blocks", a, a)).toThrow(
      expect.objectContaining({ code: "TASK_RELATION_CYCLE" }) as DomainError,
    );
    expect(() =>
      canonicalizeRelation("blocks", a, task("b", { workspaceId: "workspace-2" })),
    ).toThrow(expect.objectContaining({ code: "TASK_NOT_FOUND" }) as DomainError);
    expect(() =>
      canonicalizeRelation("blocks", a, deleteTask(task("b"), testContext())),
    ).toThrow(expect.objectContaining({ code: "TASK_NOT_FOUND" }) as DomainError);
  });
});

describe("assertNoBlocksCycle", () => {
  it("accepts a chain and rejects a direct or transitive loop", () => {
    // A blocks B, B blocks C: adding C blocks D is fine.
    expect(() => assertNoBlocksCycle("c", "d", [])).not.toThrow();
    // A blocks B: B blocks A is a two-node cycle.
    expect(() => assertNoBlocksCycle("b", "a", ["b"])).toThrow(
      expect.objectContaining({ code: "TASK_RELATION_CYCLE" }) as DomainError,
    );
    // A blocks B, B blocks C: C blocks A closes the loop through B.
    expect(() => assertNoBlocksCycle("c", "a", ["b", "c"])).toThrow(
      expect.objectContaining({ code: "TASK_RELATION_CYCLE" }) as DomainError,
    );
    expect(() => assertNoBlocksCycle("a", "a", [])).toThrow(
      expect.objectContaining({ code: "TASK_RELATION_CYCLE" }) as DomainError,
    );
  });
});

describe("isBlocked", () => {
  it("is true for a flag or an open predecessor, and never for a completed task", () => {
    const open = task("open");
    const done = completeTask(task("done"), {}, testContext());
    const trashed = deleteTask(task("trashed"), testContext());

    expect(isBlocked(task("t"), [])).toBe(false);
    expect(isBlocked(task("t"), [open])).toBe(true);
    expect(isBlocked(task("t"), [done])).toBe(false);
    expect(isBlocked(task("t"), [trashed])).toBe(false);
    expect(isBlocked(flagBlocked(task("t"), "vendor", testContext()), [])).toBe(true);
    expect(
      isBlocked(
        completeTask(
          flagBlocked(task("t"), "vendor", testContext()),
          {},
          testContext(),
        ),
        [open],
      ),
    ).toBe(false);
  });
});

describe("normalizeBlockedReason", () => {
  it("trims and collapses whitespace, and requires something", () => {
    expect(normalizeBlockedReason("  waiting   on vendor ")).toBe("waiting on vendor");
    expect(() => normalizeBlockedReason("   ")).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }) as DomainError,
    );
    expect(() => normalizeBlockedReason("x".repeat(501))).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }) as DomainError,
    );
  });
});

describe("isRelationType", () => {
  it("accepts only the MVP types", () => {
    expect(isRelationType("blocks")).toBe(true);
    expect(isRelationType("related_to")).toBe(true);
    expect(isRelationType("duplicates")).toBe(false);
  });
});
