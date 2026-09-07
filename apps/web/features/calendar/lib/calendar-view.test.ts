import type { CalendarViewResponse, TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  calendarDays,
  patchTaskInCalendar,
  shiftPeriod,
  validCalendarDate,
} from "./calendar-view";
describe("calendar ranges", () => {
  it("uses Monday-start month/week grids across years and leap days", () => {
    const month = calendarDays("2026-01-01", "month");
    expect(month[0]).toBe("2025-12-29");
    expect(month).toHaveLength(42);
    expect(calendarDays("2028-02-29", "week")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
      "2028-03-02",
      "2028-03-03",
      "2028-03-04",
      "2028-03-05",
    ]);
    expect(shiftPeriod("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(validCalendarDate("2026-02-30")).toBe(false);
    expect(validCalendarDate("2028-02-29")).toBe(true);
  });
});

describe("optimistic calendar membership", () => {
  const task = {
    id: "task-1",
    dueDate: "2026-09-07",
    deadline: null,
    deferUntil: null,
    isCompleted: false,
    deletedAt: null,
  } as TaskDto;
  const view: CalendarViewResponse = {
    data: {
      from: "2026-09-01",
      to: "2026-09-30",
      timezone: "UTC",
      tasks: [task],
      truncated: false,
    },
  };
  it("moves tasks out of a range, keeps an in-range deadline, and removes completed work", () => {
    expect(
      patchTaskInCalendar(view, { ...task, dueDate: "2026-10-01" }).data.tasks,
    ).toHaveLength(0);
    expect(
      patchTaskInCalendar(view, {
        ...task,
        dueDate: "2026-10-01",
        deadline: "2026-09-30",
      }).data.tasks,
    ).toHaveLength(1);
    expect(
      patchTaskInCalendar(view, { ...task, isCompleted: true }).data.tasks,
    ).toHaveLength(0);
    expect(view.data.tasks).toHaveLength(1);
  });
  it("inserts new in-range captures only into complete projections", () => {
    const created = { ...task, id: "task-2" };
    expect(patchTaskInCalendar(view, created).data.tasks).toHaveLength(2);
    expect(
      patchTaskInCalendar({ data: { ...view.data, truncated: true } }, created).data
        .tasks,
    ).toHaveLength(1);
  });
});
