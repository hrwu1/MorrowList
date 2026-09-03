import { describe, expect, it } from "vitest";

import { TEST_INSTANT, testActor } from "./fixtures.js";
import type { Task } from "./task.js";
import { todaySections, upcomingGroups } from "./today.js";
import { addDays, toLocalDate, type PlainDate } from "./values.js";

const TODAY = "2026-09-03" as PlainDate;

function task(overrides: Partial<Task> & { readonly id: string }): Task {
  return {
    workspaceId: "ws-1",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: overrides.id,
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    reminderOffsetMinutes: null,
    parentTaskId: null,
    rank: "a0",
    lastActiveStatusId: null,
    completedAt: null,
    blockedReason: null,
    blockedSince: null,
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

function date(value: string): PlainDate {
  return value as PlainDate;
}

describe("toLocalDate", () => {
  it("evaluates the calendar date in the workspace timezone, not UTC", () => {
    const instant = new Date("2026-08-31T23:30:00.000Z");

    expect(toLocalDate(instant, "UTC")).toBe("2026-08-31");
    expect(toLocalDate(instant, "Europe/Berlin")).toBe("2026-09-01");
    expect(toLocalDate(instant, "America/Los_Angeles")).toBe("2026-08-31");
    expect(toLocalDate(instant, "Pacific/Kiritimati")).toBe("2026-09-01");
  });

  it("stays on the previous day west of the date line just after UTC midnight", () => {
    const instant = new Date("2026-09-01T00:10:00.000Z");

    expect(toLocalDate(instant, "Pacific/Pago_Pago")).toBe("2026-08-31");
    expect(toLocalDate(instant, "Pacific/Auckland")).toBe("2026-09-01");
  });
});

describe("addDays", () => {
  it("crosses month, year, and leap-day boundaries", () => {
    expect(addDays(date("2026-08-31"), 1)).toBe("2026-09-01");
    expect(addDays(date("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(date("2028-02-28"), 1)).toBe("2028-02-29");
    expect(addDays(date("2026-03-01"), -1)).toBe("2026-02-28");
    expect(addDays(date("2026-09-03"), 14)).toBe("2026-09-17");
  });
});

describe("todaySections", () => {
  it("places a task once, in the highest-precedence section, with every badge", () => {
    // Completion criterion: overdue and in My Day shows under Overdue with both badges.
    const overdueAndPlanned = task({ id: "a", dueDate: date("2026-09-01") });
    const dueTodayAndPlanned = task({ id: "b", dueDate: TODAY });
    const plannedOnly = task({ id: "c" });
    const dueTodayOnly = task({ id: "d", dueDate: TODAY });

    const sections = todaySections(
      [dueTodayOnly, plannedOnly, dueTodayAndPlanned, overdueAndPlanned],
      new Set(["a", "b", "c"]),
      TODAY,
    );

    expect(sections.map((section) => section.id)).toEqual([
      "overdue",
      "due_today",
      "my_day",
    ]);
    expect(sections[0]?.tasks).toEqual([
      { task: overdueAndPlanned, reasons: ["overdue", "my_day"] },
    ]);
    expect(sections[1]?.tasks.map((entry) => entry.task.id)).toEqual(["b", "d"]);
    expect(sections[1]?.tasks[0]?.reasons).toEqual(["due_today", "my_day"]);
    expect(sections[1]?.tasks[1]?.reasons).toEqual(["due_today"]);
    expect(sections[2]?.tasks).toEqual([{ task: plannedOnly, reasons: ["my_day"] }]);

    const ids = sections.flatMap((section) => section.tasks.map((e) => e.task.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("excludes completed, deleted, future, and unplanned tasks", () => {
    const sections = todaySections(
      [
        task({ id: "done", dueDate: TODAY, completedAt: TEST_INSTANT }),
        task({ id: "gone", dueDate: date("2026-09-01"), deletedAt: TEST_INSTANT }),
        task({ id: "later", dueDate: date("2026-09-04") }),
        task({ id: "unplanned" }),
        task({ id: "planned-but-done", completedAt: TEST_INSTANT }),
      ],
      new Set(["planned-but-done"]),
      TODAY,
    );

    expect(sections.every((section) => section.tasks.length === 0)).toBe(true);
  });

  it("orders overdue by due date then rank, and the other sections by rank", () => {
    const sections = todaySections(
      [
        task({ id: "x", dueDate: date("2026-09-02"), rank: "a0" }),
        task({ id: "y", dueDate: date("2026-08-20"), rank: "z9" }),
        task({ id: "p", rank: "b0" }),
        task({ id: "q", rank: "a5" }),
      ],
      new Set(["p", "q"]),
      TODAY,
    );

    expect(sections[0]?.tasks.map((entry) => entry.task.id)).toEqual(["y", "x"]);
    expect(sections[2]?.tasks.map((entry) => entry.task.id)).toEqual(["q", "p"]);
  });

  it("does not roll yesterday's selection forward", () => {
    // A plan is date-bound (spec 9.2): a task planned only for yesterday is absent today.
    const sections = todaySections([task({ id: "stale" })], new Set(), TODAY);

    expect(sections.flatMap((section) => section.tasks)).toEqual([]);
  });
});

describe("upcomingGroups", () => {
  const tasks = [
    task({ id: "today", dueDate: TODAY }),
    task({
      id: "tomorrow-timed",
      dueDate: date("2026-09-04"),
      dueTime: "09:00" as never,
    }),
    task({ id: "tomorrow-plain", dueDate: date("2026-09-04"), rank: "z" }),
    task({ id: "week", dueDate: date("2026-09-10") }),
    task({ id: "edge", dueDate: date("2026-09-17") }),
    task({ id: "beyond", dueDate: date("2026-09-18") }),
    task({ id: "done", dueDate: date("2026-09-05"), completedAt: TEST_INSTANT }),
    task({ id: "undated" }),
  ];

  it("groups open future tasks by date within an inclusive horizon", () => {
    const groups = upcomingGroups(tasks, TODAY, 14);

    expect(groups.map((group) => group.date)).toEqual([
      "2026-09-04",
      "2026-09-10",
      "2026-09-17",
    ]);
    // Date-only tasks lead the day; timed tasks follow in time order (spec 9.3).
    expect(groups[0]?.tasks.map((item) => item.id)).toEqual([
      "tomorrow-plain",
      "tomorrow-timed",
    ]);
  });

  it("includes every future date when the horizon is open", () => {
    const groups = upcomingGroups(tasks, TODAY, null);

    expect(groups.at(-1)?.date).toBe("2026-09-18");
  });

  it("never includes today or overdue work", () => {
    const groups = upcomingGroups(
      [task({ id: "late", dueDate: date("2026-09-01") }), ...tasks],
      TODAY,
      7,
    );

    expect(groups.flatMap((group) => group.tasks.map((item) => item.id))).toEqual([
      "tomorrow-plain",
      "tomorrow-timed",
      "week",
    ]);
  });
});

describe("deferred tasks (GAP-16)", () => {
  it("keeps a deferred task out of Today unless it is in My Day, and then only as My Day", () => {
    const deferredOverdue = task({
      id: "deferred",
      dueDate: date("2026-09-01"),
      deferUntil: date("2026-09-10"),
    });
    const deferredPlanned = task({
      id: "chosen",
      dueDate: TODAY,
      deferUntil: date("2026-09-10"),
    });
    const returned = task({ id: "back", dueDate: TODAY, deferUntil: TODAY });

    const sections = todaySections(
      [deferredOverdue, deferredPlanned, returned],
      new Set(["chosen"]),
      TODAY,
    );

    expect(sections[0]?.tasks).toEqual([]);
    expect(sections[1]?.tasks).toEqual([{ task: returned, reasons: ["due_today"] }]);
    expect(sections[2]?.tasks).toEqual([
      { task: deferredPlanned, reasons: ["my_day"] },
    ]);
  });

  it("leaves deferred tasks out of Upcoming until their defer date", () => {
    const hidden = task({
      id: "hidden",
      dueDate: date("2026-09-05"),
      deferUntil: date("2026-09-04"),
    });
    const shown = task({
      id: "shown",
      dueDate: date("2026-09-05"),
      deferUntil: TODAY,
    });

    expect(
      upcomingGroups([hidden, shown], TODAY, 14).flatMap((g) =>
        g.tasks.map((t) => t.id),
      ),
    ).toEqual(["shown"]);
    expect(
      upcomingGroups([hidden], date("2026-09-04"), 14).flatMap((g) =>
        g.tasks.map((t) => t.id),
      ),
    ).toEqual(["hidden"]);
  });
});
