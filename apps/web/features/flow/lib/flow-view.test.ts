import type { AgingItemDto, FlowDayDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  ageBand,
  agingChart,
  cumulativeFlowAreas,
  daysInStatus,
  formatDays,
  readBoardAge,
  readFlowRange,
  throughputBars,
  usuallyDoneLabel,
} from "./flow-view";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

describe("card age", () => {
  it("counts whole days in the column and fades at 7 and 14 days", () => {
    expect(daysInStatus("2026-08-20T09:00:00.000Z", NOW)).toBe(0);
    expect(daysInStatus("2026-08-13T11:00:00.000Z", NOW)).toBe(7);
    expect(daysInStatus("2026-08-01T12:00:00.000Z", NOW)).toBe(19);
    expect(daysInStatus(null, NOW)).toBeNull();
    expect(daysInStatus(undefined, NOW)).toBeNull();
    // A clock that is behind the server never shows a negative age.
    expect(daysInStatus("2026-08-21T12:00:00.000Z", NOW)).toBe(0);

    expect(ageBand(0)).toBe("fresh");
    expect(ageBand(6)).toBe("fresh");
    expect(ageBand(7)).toBe("aging");
    expect(ageBand(14)).toBe("stale");
    expect(ageBand(null)).toBeNull();
  });

  it("reads the board age toggle and the flow range from the URL", () => {
    expect(readBoardAge(new URLSearchParams(""))).toBe(true);
    expect(readBoardAge(new URLSearchParams("age=off"))).toBe(false);
    expect(readFlowRange(new URLSearchParams(""))).toBe("90");
    expect(readFlowRange(new URLSearchParams("range=30"))).toBe("30");
    expect(readFlowRange(new URLSearchParams("range=7"))).toBe("90");
  });

  it("formats durations and the column hint", () => {
    expect(formatDays(null)).toBe("—");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(3.46)).toBe("3.5 days");
    expect(usuallyDoneLabel(null)).toBeNull();
    expect(usuallyDoneLabel(0.2)).toBe("Usually done in 1 day");
    expect(usuallyDoneLabel(3.1)).toBe("Usually done in 4 days");
  });
});

describe("throughputBars", () => {
  it("scales bars to the busiest week and keeps a zero week visible as a slot", () => {
    const bars = throughputBars(
      [
        { weekStart: "2026-08-03", count: 2 },
        { weekStart: "2026-08-10", count: 0 },
        { weekStart: "2026-08-17", count: 4 },
      ],
      { width: 300, height: 100 },
    );
    expect(bars).toHaveLength(3);
    expect(bars[2]?.height).toBe(100);
    expect(bars[0]?.height).toBe(50);
    expect(bars[1]?.height).toBe(0);
    expect(bars[1]?.x).toBeGreaterThan(bars[0]?.x ?? 0);
  });
});

describe("cumulativeFlowAreas", () => {
  it("stacks the categories with Done at the floor on one shared scale", () => {
    const day = (date: string, done: number, ready: number): FlowDayDto => ({
      date,
      counts: { backlog: 0, ready, in_progress: 0, blocked: 0, review: 0, done },
    });
    const areas = cumulativeFlowAreas(
      [day("2026-08-01", 1, 1), day("2026-08-02", 2, 2)],
      { width: 100, height: 100 },
    );
    expect(areas.map((area) => area.category)[0]).toBe("done");
    const done = areas.find((area) => area.category === "done");
    const ready = areas.find((area) => area.category === "ready");
    // Day two totals four tasks: Done reaches half the height, Ready sits on top of it.
    expect(done?.path).toContain("100.0,50.0");
    expect(ready?.path).toContain("100.0,0.0");
    expect(ready?.path).toContain("L100.0,50.0");
  });
});

describe("agingChart", () => {
  const item = (overrides: Partial<AgingItemDto>): AgingItemDto => ({
    taskId: "01a04e0f-0000-7000-8000-000000000001",
    key: "ML-1",
    title: "Item",
    statusId: "01a04e0f-0000-7000-8000-000000000002",
    statusName: "In Progress",
    category: "in_progress",
    ageDays: 3,
    band: "under_p50",
    ...overrides,
  });

  it("places items in their column lane on the same scale as the percentile lines", () => {
    const chart = agingChart(
      [
        item({ ageDays: 3 }),
        item({ ageDays: 3, key: "ML-2" }),
        item({ category: "review", ageDays: 12 }),
      ],
      { p50: 2, p85: 6, p95: 10 },
      { width: 300, height: 120 },
    );
    expect(chart.maxDays).toBe(12);
    expect(chart.columns.map((column) => column.category)).toEqual([
      "in_progress",
      "blocked",
      "review",
    ]);
    expect(chart.lines.map((line) => line.label)).toEqual(["50th", "85th", "95th"]);
    expect(chart.dots[2]?.cy).toBe(0);
    expect(chart.dots[0]?.cx).not.toBe(chart.dots[1]?.cx);
    expect(chart.dots[0]?.cy).toBe(chart.dots[1]?.cy);
  });

  it("draws no reference lines without completed work", () => {
    const chart = agingChart(
      [item({})],
      { p50: null, p85: null, p95: null },
      {
        width: 300,
        height: 120,
      },
    );
    expect(chart.lines).toEqual([]);
    expect(chart.maxDays).toBe(3);
  });
});
