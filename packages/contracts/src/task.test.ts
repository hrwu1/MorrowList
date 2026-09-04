import { describe, expect, it } from "vitest";

import {
  addTaskRelationRequestSchema,
  completeTaskRequestSchema,
  createTaskRequestSchema,
  listTasksQuerySchema,
  setTaskBlockedRequestSchema,
  moveTaskRequestSchema,
  reorderTaskRequestSchema,
  setTaskParentRequestSchema,
  updateTaskRequestSchema,
} from "./task.js";

const PROJECT_ID = "0198f0a0-0000-7000-8000-000000000000";
const STATUS_ID = "0198f0a0-0000-7000-8000-000000000001";
const TASK_ID = "0198f0a0-0000-7000-8000-000000000002";

describe("createTaskRequestSchema", () => {
  it("accepts a title on its own", () => {
    const parsed = createTaskRequestSchema.parse({ title: "Capture this" });

    expect(parsed.title).toBe("Capture this");
    expect(parsed.projectId).toBeUndefined();
  });

  it("trims the title and rejects a blank one", () => {
    expect(createTaskRequestSchema.parse({ title: "  spaced  " }).title).toBe("spaced");
    expect(createTaskRequestSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects a due time without a due date", () => {
    const result = createTaskRequestSchema.safeParse({
      title: "x",
      dueTime: "09:30",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a status without a project", () => {
    const result = createTaskRequestSchema.safeParse({
      title: "x",
      statusId: "0198f0a0-0000-7000-8000-000000000000",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateTaskRequestSchema", () => {
  it("distinguishes an omitted field from an explicit null", () => {
    const omitted = updateTaskRequestSchema.parse({ title: "New" });
    expect("descriptionMd" in omitted).toBe(false);

    const cleared = updateTaskRequestSchema.parse({ descriptionMd: null });
    expect(cleared.descriptionMd).toBeNull();
  });

  it("rejects an empty patch", () => {
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ expectedVersion: 3 }).success).toBe(
      false,
    );
  });
});

describe("listTasksQuerySchema", () => {
  it("applies pagination and sort defaults", () => {
    const query = listTasksQuerySchema.parse({});

    expect(query.limit).toBe(50);
    expect(query.sort).toBe("rank");
    expect(query.order).toBe("asc");
    expect(query.includeSubtasks).toBe(true);
  });

  it("coerces query-string booleans and numbers", () => {
    const query = listTasksQuerySchema.parse({
      limit: "200",
      isCompleted: "false",
      inbox: "true",
    });

    expect(query.limit).toBe(200);
    expect(query.isCompleted).toBe(false);
    expect(query.inbox).toBe(true);
  });

  it("caps the page size at 200", () => {
    expect(listTasksQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
});

describe("task movement schemas", () => {
  it("allows a project move with one or two distinct neighbours", () => {
    expect(
      moveTaskRequestSchema.parse({
        projectId: PROJECT_ID,
        statusId: STATUS_ID,
        beforeTaskId: TASK_ID,
      }),
    ).toMatchObject({ projectId: PROJECT_ID, statusId: STATUS_ID });
  });

  it("rejects a status when moving to the Inbox", () => {
    expect(
      moveTaskRequestSchema.safeParse({ projectId: null, statusId: STATUS_ID }).success,
    ).toBe(false);
  });

  it("rejects the same task as both neighbours", () => {
    expect(
      reorderTaskRequestSchema.safeParse({
        beforeTaskId: TASK_ID,
        afterTaskId: TASK_ID,
      }).success,
    ).toBe(false);
  });
});

describe("setTaskParentRequestSchema", () => {
  it("requires a parent id and accepts an optional expected version", () => {
    expect(setTaskParentRequestSchema.parse({ parentTaskId: TASK_ID })).toEqual({
      parentTaskId: TASK_ID,
    });
    expect(
      setTaskParentRequestSchema.parse({ parentTaskId: TASK_ID, expectedVersion: 2 })
        .expectedVersion,
    ).toBe(2);
    expect(setTaskParentRequestSchema.safeParse({}).success).toBe(false);
    expect(setTaskParentRequestSchema.safeParse({ parentTaskId: "ML-1" }).success).toBe(
      false,
    );
  });
});

describe("relation and blocked schemas", () => {
  it("accepts the MVP relation types only", () => {
    expect(
      addTaskRelationRequestSchema.parse({ type: "blocks", targetTaskId: TASK_ID }),
    ).toEqual({ type: "blocks", targetTaskId: TASK_ID });
    expect(
      addTaskRelationRequestSchema.safeParse({
        type: "duplicates",
        targetTaskId: TASK_ID,
      }).success,
    ).toBe(false);
  });

  it("requires a non-blank reason and passes the blocked acknowledgement", () => {
    expect(setTaskBlockedRequestSchema.parse({ reason: "  vendor " }).reason).toBe(
      "vendor",
    );
    expect(setTaskBlockedRequestSchema.safeParse({ reason: "   " }).success).toBe(
      false,
    );
    expect(completeTaskRequestSchema.parse({ acknowledgeBlocked: true })).toEqual({
      acknowledgeBlocked: true,
    });
  });
});

describe("recurrenceRuleSchema", () => {
  it("fills the parts a frequency does not use with null", () => {
    const parsed = createTaskRequestSchema.parse({
      title: "Water plants",
      recurrence: { freq: "weekly", weekdays: ["mon", "thu"] },
    });

    expect(parsed.recurrence).toEqual({
      freq: "weekly",
      interval: 1,
      mode: "schedule",
      weekdays: ["mon", "thu"],
      monthDay: null,
      nthWeekday: null,
      until: null,
      count: null,
    });
  });

  it("accepts an nth weekday and bounds, and rejects out-of-range values", () => {
    const parsed = updateTaskRequestSchema.parse({
      recurrence: {
        freq: "monthly",
        interval: 2,
        nthWeekday: { nth: -1, weekday: "fri" },
        until: "2027-01-01",
      },
    });
    expect(parsed.recurrence).toMatchObject({
      nthWeekday: { nth: -1, weekday: "fri" },
    });

    expect(
      updateTaskRequestSchema.safeParse({ recurrence: { freq: "daily", interval: 0 } })
        .success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({
        recurrence: { freq: "monthly", monthDay: 32 },
      }).success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({
        recurrence: { freq: "monthly", nthWeekday: { nth: 5, weekday: "fri" } },
      }).success,
    ).toBe(false);
    expect(updateTaskRequestSchema.parse({ recurrence: null }).recurrence).toBeNull();
  });

  it("lists a series by id", () => {
    expect(listTasksQuerySchema.parse({ seriesId: TASK_ID }).seriesId).toBe(TASK_ID);
  });
});

describe("defer and deadline dates (GAP-16)", () => {
  it("accepts the three dates on create and rejects a deadline time without a deadline", () => {
    const parsed = createTaskRequestSchema.parse({
      title: "x",
      deferUntil: "2026-09-01",
      deadline: "2026-09-05",
      deadlineTime: "17:00",
    });
    expect(parsed).toMatchObject({
      deferUntil: "2026-09-01",
      deadline: "2026-09-05",
      deadlineTime: "17:00",
    });

    expect(
      createTaskRequestSchema.safeParse({ title: "x", deadlineTime: "17:00" }).success,
    ).toBe(false);
  });

  it("lets a patch clear each date explicitly", () => {
    const cleared = updateTaskRequestSchema.parse({ deferUntil: null, deadline: null });
    expect(cleared.deferUntil).toBeNull();
    expect(cleared.deadline).toBeNull();
    expect("deadlineTime" in cleared).toBe(false);
  });

  it("parses the deferred and deadline list filters", () => {
    const query = listTasksQuerySchema.parse({ deferred: "false", deadline: "week" });
    expect(query.deferred).toBe(false);
    expect(query.deadline).toBe("week");
    expect(listTasksQuerySchema.safeParse({ deadline: "soon" }).success).toBe(false);
    expect(listTasksQuerySchema.parse({}).deferred).toBeUndefined();
  });
});
