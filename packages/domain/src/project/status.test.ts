import { describe, expect, it } from "vitest";

import { ranksBetween } from "../shared/rank.js";
import { testStatus } from "../task/fixtures.js";

import {
  DEFAULT_WORKFLOW,
  archiveStatus,
  assertWorkflowInvariants,
  createStatus,
  reorderStatus,
  updateStatus,
  type WorkflowStatus,
} from "./status.js";

const NOW = new Date("2026-09-01T10:00:00.000Z");

/** The default six-column workflow, ranked in order, ids `status-<category>`. */
function workflow(): WorkflowStatus[] {
  const ranks = ranksBetween(null, null, DEFAULT_WORKFLOW.length);
  return DEFAULT_WORKFLOW.map((template, index) =>
    testStatus({
      category: template.category,
      name: template.name,
      rank: ranks[index] as string,
      isDefault: template.isDefault,
    }),
  );
}

function byId(statuses: readonly WorkflowStatus[], id: string): WorkflowStatus {
  const status = statuses.find((candidate) => candidate.id === id);
  if (!status) throw new Error(`no status ${id}`);
  return status;
}

describe("assertWorkflowInvariants", () => {
  it("accepts the default workflow", () => {
    expect(() => assertWorkflowInvariants(workflow())).not.toThrow();
  });

  it("requires exactly one default", () => {
    const none = workflow().map((status) => ({ ...status, isDefault: false }));
    expect(() => assertWorkflowInvariants(none)).toThrow(
      expect.objectContaining({
        code: "WORKFLOW_INVARIANT_VIOLATED",
        details: { invariant: "one_default", defaultCount: 0 },
      }),
    );

    const two = workflow().map((status) => ({ ...status, isDefault: true }));
    expect(() => assertWorkflowInvariants(two)).toThrow(
      expect.objectContaining({
        details: { invariant: "one_default", defaultCount: 6 },
      }),
    );
  });

  it("rejects a Done default", () => {
    const statuses = workflow().map((status) => ({
      ...status,
      isDefault: status.category === "done",
    }));
    expect(() => assertWorkflowInvariants(statuses)).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ invariant: "default_not_terminal" }),
      }),
    );
  });

  it("requires at least one terminal and one nonterminal status", () => {
    const noDone = workflow().filter((status) => status.category !== "done");
    expect(() => assertWorkflowInvariants(noDone)).toThrow(
      expect.objectContaining({ details: { invariant: "terminal_required" } }),
    );

    const onlyDone = [testStatus({ category: "done", isDefault: true })];
    // The Done default trips the earlier check first; a non-default Done alone trips this one.
    expect(() => assertWorkflowInvariants(onlyDone)).toThrow(
      expect.objectContaining({ code: "WORKFLOW_INVARIANT_VIOLATED" }),
    );
  });
});

describe("createStatus", () => {
  it("appends a normalized, non-default column after the last rank", () => {
    const statuses = workflow();
    const created = createStatus(
      {
        id: "status-testing",
        projectId: "project-1",
        name: "  Testing  ",
        category: "review",
        wipLimit: 3,
        policyMd: "  Two reviewers.  ",
      },
      statuses,
    );

    expect(created).toMatchObject({
      name: "Testing",
      category: "review",
      colorToken: "slate",
      wipLimit: 3,
      isDefault: false,
      policyMd: "Two reviewers.",
      archivedAt: null,
      version: 1,
    });
    expect(created.rank > (statuses.at(-1) as WorkflowStatus).rank).toBe(true);
  });

  it("ranks after archived columns too, so ranks never collide", () => {
    const statuses = workflow();
    const archived = { ...(statuses.at(-1) as WorkflowStatus), archivedAt: NOW };
    const created = createStatus(
      { id: "s", projectId: "project-1", name: "Later", category: "backlog" },
      [...statuses.slice(0, -1), archived],
    );
    expect(created.rank > archived.rank).toBe(true);
  });

  it("validates the name and WIP limit", () => {
    expect(() =>
      createStatus(
        { id: "s", projectId: "project-1", name: "   ", category: "backlog" },
        workflow(),
      ),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      createStatus(
        { id: "s", projectId: "project-1", name: "x".repeat(81), category: "backlog" },
        workflow(),
      ),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      createStatus(
        {
          id: "s",
          projectId: "project-1",
          name: "QA",
          category: "backlog",
          wipLimit: 0,
        },
        workflow(),
      ),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("updateStatus", () => {
  it("renames without touching the category or completion semantics", () => {
    const statuses = workflow();
    const [renamed] = updateStatus(statuses, "status-done", { name: "  Shipped " });

    expect(renamed).toMatchObject({
      id: "status-done",
      name: "Shipped",
      category: "done",
      version: 2,
    });
  });

  it("returns nothing when nothing material changed", () => {
    expect(updateStatus(workflow(), "status-ready", { name: "Ready" })).toEqual([]);
  });

  it("promotes a new default and demotes the previous one together", () => {
    const changed = updateStatus(workflow(), "status-backlog", { isDefault: true });

    expect(
      changed.map((status) => [status.id, status.isDefault, status.version]),
    ).toEqual([
      ["status-backlog", true, 2],
      ["status-ready", false, 2],
    ]);
  });

  it("refuses to clear the default without a replacement", () => {
    expect(() =>
      updateStatus(workflow(), "status-ready", { isDefault: false }),
    ).toThrow(
      expect.objectContaining({
        code: "WORKFLOW_INVARIANT_VIOLATED",
        details: expect.objectContaining({ invariant: "one_default" }),
      }),
    );
  });

  it("refuses to make the default a Done status", () => {
    expect(() =>
      updateStatus(workflow(), "status-ready", { category: "done" }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ invariant: "default_not_terminal" }),
      }),
    );
    expect(() => updateStatus(workflow(), "status-done", { isDefault: true })).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ invariant: "default_not_terminal" }),
      }),
    );
  });

  it("refuses to change the last Done status to another category", () => {
    expect(() =>
      updateStatus(workflow(), "status-done", { category: "review" }),
    ).toThrow(expect.objectContaining({ details: { invariant: "terminal_required" } }));
  });

  it("allows a category change when another Done status remains", () => {
    const statuses = [
      ...workflow(),
      testStatus({
        id: "status-shipped",
        category: "done",
        rank: "b0",
        isDefault: false,
      }),
    ];
    const [changed] = updateStatus(statuses, "status-done", { category: "review" });
    expect(changed?.category).toBe("review");
  });

  it("clears and validates the WIP limit and policy", () => {
    const statuses = workflow().map((status) =>
      status.id === "status-ready"
        ? { ...status, wipLimit: 4, policyMd: "Keep it small." }
        : status,
    );
    const [cleared] = updateStatus(statuses, "status-ready", {
      wipLimit: null,
      policyMd: "   ",
    });
    expect(cleared).toMatchObject({ wipLimit: null, policyMd: null });
    expect(() => updateStatus(statuses, "status-ready", { wipLimit: -1 })).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("ignores archived statuses", () => {
    const statuses = workflow().map((status) =>
      status.id === "status-blocked" ? { ...status, archivedAt: NOW } : status,
    );
    expect(() => updateStatus(statuses, "status-blocked", { name: "X" })).toThrow(
      expect.objectContaining({ code: "STATUS_NOT_FOUND" }),
    );
  });
});

describe("reorderStatus", () => {
  it("places a column between two neighbours", () => {
    const statuses = workflow();
    const moved = reorderStatus(statuses, "status-done", {
      beforeStatusId: "status-backlog",
      afterStatusId: "status-ready",
    });

    expect(moved.rank > byId(statuses, "status-backlog").rank).toBe(true);
    expect(moved.rank < byId(statuses, "status-ready").rank).toBe(true);
    expect(moved.version).toBe(2);
  });

  it("moves to the start or the end with one neighbour or none", () => {
    const statuses = workflow();
    const first = reorderStatus(statuses, "status-done", {
      afterStatusId: "status-backlog",
    });
    expect(first.rank < byId(statuses, "status-backlog").rank).toBe(true);

    const last = reorderStatus(statuses, "status-backlog", {});
    expect(last.rank > byId(statuses, "status-done").rank).toBe(true);
  });

  it("rejects self, duplicate, unknown, and out-of-order neighbours", () => {
    const statuses = workflow();
    expect(() =>
      reorderStatus(statuses, "status-done", { beforeStatusId: "status-done" }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      reorderStatus(statuses, "status-done", {
        beforeStatusId: "status-ready",
        afterStatusId: "status-ready",
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      reorderStatus(statuses, "status-done", { beforeStatusId: "nope" }),
    ).toThrow(expect.objectContaining({ code: "STATUS_NOT_FOUND" }));
    expect(() =>
      reorderStatus(statuses, "status-done", {
        beforeStatusId: "status-ready",
        afterStatusId: "status-backlog",
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("archiveStatus", () => {
  it("archives an empty, non-default column", () => {
    const result = archiveStatus(
      workflow(),
      "status-blocked",
      { hasTasks: false },
      NOW,
    );

    expect(result.archived).toMatchObject({
      id: "status-blocked",
      archivedAt: NOW,
      isDefault: false,
      version: 2,
    });
    expect(result.destination).toBeNull();
    expect(result.newDefault).toBeNull();
  });

  it("requires a destination when the column has tasks", () => {
    expect(() =>
      archiveStatus(workflow(), "status-blocked", { hasTasks: true }, NOW),
    ).toThrow(expect.objectContaining({ code: "STATUS_ARCHIVE_REQUIRES_DESTINATION" }));

    const result = archiveStatus(
      workflow(),
      "status-blocked",
      { hasTasks: true, destinationStatusId: "status-ready" },
      NOW,
    );
    expect(result.destination?.id).toBe("status-ready");
  });

  it("rejects the column itself or an archived column as destination", () => {
    expect(() =>
      archiveStatus(
        workflow(),
        "status-blocked",
        { hasTasks: true, destinationStatusId: "status-blocked" },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));

    const statuses = workflow().map((status) =>
      status.id === "status-review" ? { ...status, archivedAt: NOW } : status,
    );
    expect(() =>
      archiveStatus(
        statuses,
        "status-blocked",
        { hasTasks: true, destinationStatusId: "status-review" },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "STATUS_NOT_FOUND" }));
  });

  it("requires a replacement when archiving the default", () => {
    expect(() =>
      archiveStatus(workflow(), "status-ready", { hasTasks: false }, NOW),
    ).toThrow(expect.objectContaining({ code: "STATUS_ARCHIVE_REQUIRES_REPLACEMENT" }));
    // A Done column cannot be the replacement default.
    expect(() =>
      archiveStatus(
        workflow(),
        "status-ready",
        { hasTasks: false, newDefaultStatusId: "status-done" },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "STATUS_ARCHIVE_REQUIRES_REPLACEMENT" }));
  });

  it("promotes the named replacement, or the destination when none is named", () => {
    const explicit = archiveStatus(
      workflow(),
      "status-ready",
      { hasTasks: false, newDefaultStatusId: "status-backlog" },
      NOW,
    );
    expect(explicit.newDefault).toMatchObject({
      id: "status-backlog",
      isDefault: true,
      version: 2,
    });

    const implicit = archiveStatus(
      workflow(),
      "status-ready",
      { hasTasks: true, destinationStatusId: "status-in_progress" },
      NOW,
    );
    expect(implicit.newDefault?.id).toBe("status-in_progress");
    // The destination handed back is the promoted copy, so the caller persists one row.
    expect(implicit.destination).toBe(implicit.newDefault);
  });

  it("refuses to archive the last Done status", () => {
    expect(() =>
      archiveStatus(workflow(), "status-done", { hasTasks: false }, NOW),
    ).toThrow(
      expect.objectContaining({
        code: "WORKFLOW_INVARIANT_VIOLATED",
        details: { invariant: "terminal_required" },
      }),
    );
  });

  it("refuses to archive the last nonterminal status", () => {
    const statuses = [
      testStatus({ id: "only", category: "ready", isDefault: true, rank: "a0" }),
      testStatus({ id: "done", category: "done", isDefault: false, rank: "a1" }),
    ];
    expect(() =>
      archiveStatus(
        statuses,
        "only",
        { hasTasks: false, newDefaultStatusId: "done" },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "STATUS_ARCHIVE_REQUIRES_REPLACEMENT" }));
  });

  it("ignores an already archived column", () => {
    const statuses = workflow().map((status) =>
      status.id === "status-blocked" ? { ...status, archivedAt: NOW } : status,
    );
    expect(() =>
      archiveStatus(statuses, "status-blocked", { hasTasks: false }, NOW),
    ).toThrow(expect.objectContaining({ code: "STATUS_NOT_FOUND" }));
  });
});
