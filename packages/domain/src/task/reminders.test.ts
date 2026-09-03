import { describe, expect, it } from "vitest";

import { testContext } from "./fixtures.js";
import { createTask, updateTaskFields } from "./policies.js";
import { dueInstant, scheduleReminder } from "./reminders.js";
import { toInstant, toPlainDate, toPlainTime, toReminderOffset } from "./values.js";

const NOW = new Date("2026-09-03T09:00:00.000Z");

function timedTask(
  overrides: Parameters<typeof createTask>[0] extends infer I ? Partial<I> : never,
) {
  return createTask(
    {
      id: "task-1",
      workspaceId: "ws-1",
      taskNumber: 1,
      title: "Call the bank",
      rank: "a0",
      dueDate: toPlainDate("2026-09-03"),
      dueTime: toPlainTime("12:00"),
      dueTimezone: "Europe/Berlin",
      ...overrides,
    },
    testContext(),
  );
}

describe("toInstant", () => {
  it("converts a wall-clock time in a zone to the right instant", () => {
    expect(
      toInstant(toPlainDate("2026-09-03"), toPlainTime("12:00"), "Europe/Berlin"),
    ).toEqual(new Date("2026-09-03T10:00:00.000Z"));
    expect(toInstant(toPlainDate("2026-09-03"), toPlainTime("12:00"), "UTC")).toEqual(
      new Date("2026-09-03T12:00:00.000Z"),
    );
    expect(
      toInstant(toPlainDate("2026-09-03"), toPlainTime("00:30"), "Pacific/Auckland"),
    ).toEqual(new Date("2026-09-02T12:30:00.000Z"));
  });

  it("honours the zone's offset on either side of a DST change", () => {
    // Berlin leaves summer time on 2026-10-25 at 03:00 (back to 02:00).
    expect(
      toInstant(toPlainDate("2026-10-24"), toPlainTime("12:00"), "Europe/Berlin"),
    ).toEqual(new Date("2026-10-24T10:00:00.000Z"));
    expect(
      toInstant(toPlainDate("2026-10-26"), toPlainTime("12:00"), "Europe/Berlin"),
    ).toEqual(new Date("2026-10-26T11:00:00.000Z"));
  });

  it("resolves a time inside a spring-forward gap to the instant after it", () => {
    // 2026-03-29 02:30 does not exist in Berlin; clocks jump from 02:00 to 03:00.
    expect(
      toInstant(toPlainDate("2026-03-29"), toPlainTime("02:30"), "Europe/Berlin"),
    ).toEqual(new Date("2026-03-29T01:30:00.000Z"));
  });
});

describe("toReminderOffset", () => {
  it("accepts whole minutes up to a week and rejects the rest", () => {
    expect(toReminderOffset(0)).toBe(0);
    expect(toReminderOffset(10_080)).toBe(10_080);
    expect(() => toReminderOffset(-1)).toThrow(/between 0 and 10080/);
    expect(() => toReminderOffset(10_081)).toThrow(/between 0 and 10080/);
    expect(() => toReminderOffset(1.5)).toThrow(/whole number/);
  });
});

describe("reminder offset on the task", () => {
  it("defaults to 30 minutes when a task is created with a due time", () => {
    expect(timedTask({}).reminderOffsetMinutes).toBe(30);
  });

  it("takes the caller's default and an explicit value, and none without a due time", () => {
    expect(timedTask({ defaultReminderOffsetMinutes: 60 }).reminderOffsetMinutes).toBe(
      60,
    );
    expect(timedTask({ reminderOffsetMinutes: 5 }).reminderOffsetMinutes).toBe(5);
    expect(timedTask({ reminderOffsetMinutes: null }).reminderOffsetMinutes).toBeNull();
    expect(
      timedTask({ dueTime: null, reminderOffsetMinutes: 5 }).reminderOffsetMinutes,
    ).toBeNull();
  });

  it("applies the default the first time a due time is set, and keeps an edit after", () => {
    const undated = timedTask({ dueDate: null, dueTime: null });
    expect(undated.reminderOffsetMinutes).toBeNull();

    const timed = updateTaskFields(
      undated,
      {
        dueDate: toPlainDate("2026-09-04"),
        dueTime: toPlainTime("09:00"),
        dueTimezone: "UTC",
        defaultReminderOffsetMinutes: 15,
      },
      testContext(),
    );
    expect(timed.reminderOffsetMinutes).toBe(15);

    const edited = updateTaskFields(
      timed,
      { reminderOffsetMinutes: 120 },
      testContext(),
    );
    expect(edited.reminderOffsetMinutes).toBe(120);
    expect(edited.version).toBe(timed.version + 1);

    const moved = updateTaskFields(
      edited,
      { dueTime: toPlainTime("10:00") },
      testContext(),
    );
    expect(moved.reminderOffsetMinutes).toBe(120);
  });

  it("clears the offset with the due time and refuses one without a due time", () => {
    const cleared = updateTaskFields(timedTask({}), { dueDate: null }, testContext());
    expect(cleared.reminderOffsetMinutes).toBeNull();

    const untimed = updateTaskFields(timedTask({}), { dueTime: null }, testContext());
    expect(untimed.reminderOffsetMinutes).toBeNull();

    expect(
      updateTaskFields(untimed, { reminderOffsetMinutes: 10 }, testContext())
        .reminderOffsetMinutes,
    ).toBeNull();
  });
});

describe("scheduleReminder", () => {
  it("fires the offset before the due instant in the task's zone", () => {
    const task = timedTask({});
    expect(dueInstant(task, "UTC")).toEqual(new Date("2026-09-03T10:00:00.000Z"));
    expect(scheduleReminder(task, "UTC", NOW)).toEqual(
      new Date("2026-09-03T09:30:00.000Z"),
    );
  });

  it("falls back to the workspace zone when the task has none", () => {
    const task = { ...timedTask({}), dueTimezone: null };
    expect(scheduleReminder(task, "America/New_York", NOW)).toEqual(
      new Date("2026-09-03T15:30:00.000Z"),
    );
  });

  it("schedules nothing for done, trashed, undated, offset-less, or past reminders", () => {
    const task = timedTask({});
    expect(scheduleReminder({ ...task, completedAt: NOW }, "UTC", NOW)).toBeNull();
    expect(scheduleReminder({ ...task, deletedAt: NOW }, "UTC", NOW)).toBeNull();
    expect(scheduleReminder(timedTask({ dueTime: null }), "UTC", NOW)).toBeNull();
    expect(
      scheduleReminder(timedTask({ reminderOffsetMinutes: null }), "UTC", NOW),
    ).toBeNull();
    expect(
      scheduleReminder(task, "UTC", new Date("2026-09-03T09:30:00.000Z")),
    ).toBeNull();
    expect(scheduleReminder(task, "UTC", new Date("2026-09-03T09:29:59.000Z"))).toEqual(
      new Date("2026-09-03T09:30:00.000Z"),
    );
  });
});
