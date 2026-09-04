import type {
  AgingItemDto,
  FlowDayDto,
  FlowRange,
  FlowWeekDto,
  StatusCategory,
} from "@morrowlist/contracts";

/**
 * Pure presentation rules for flow metrics (GAP-17): card age, the fade thresholds, and
 * the geometry of the three inline SVG charts. No React and no fetching here.
 */

const DAY_MS = 86_400_000;

/** Days in the current column before a card starts to fade, and before it fades further. */
export const AGE_THRESHOLDS = { aging: 7, stale: 14 } as const;

export type AgeBand = "fresh" | "aging" | "stale";

export const FLOW_RANGE_LABELS: Record<FlowRange, string> = {
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last year",
};

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

/** Bottom to top on the cumulative flow diagram: finished work is the floor. */
export const CFD_ORDER: readonly StatusCategory[] = [
  "done",
  "review",
  "blocked",
  "in_progress",
  "ready",
  "backlog",
];

/** Columns whose work is started, so it ages. */
export const AGING_CATEGORIES: readonly StatusCategory[] = [
  "in_progress",
  "blocked",
  "review",
];

/** Whole days a card has been in its column, by the browser clock; null when unknown. */
export function daysInStatus(
  inStatusSince: string | null | undefined,
  now: number,
): number | null {
  if (!inStatusSince) return null;
  const elapsed = now - new Date(inStatusSince).getTime();
  return elapsed < 0 ? 0 : Math.floor(elapsed / DAY_MS);
}

export function ageBand(days: number | null): AgeBand | null {
  if (days === null) return null;
  if (days >= AGE_THRESHOLDS.stale) return "stale";
  if (days >= AGE_THRESHOLDS.aging) return "aging";
  return "fresh";
}

/** The board shows ages unless the view says `age=off`. */
export function readBoardAge(params: URLSearchParams): boolean {
  return params.get("age") !== "off";
}

export function readFlowRange(params: URLSearchParams): FlowRange {
  const requested = params.get("range");
  return requested === "30" || requested === "365" ? requested : "90";
}

/** "3.5 days", "1 day", or a dash when there is nothing to report. */
export function formatDays(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** The column hint from the 85th percentile, rounded up to whole days. */
export function usuallyDoneLabel(p85: number | null): string | null {
  if (p85 === null) return null;
  const days = Math.max(1, Math.ceil(p85));
  return `Usually done in ${days} ${days === 1 ? "day" : "days"}`;
}

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

export interface BarShape {
  readonly weekStart: string;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One bar per week, left to right, scaled to the busiest week. */
export function throughputBars(
  weeks: readonly FlowWeekDto[],
  size: ChartSize,
): BarShape[] {
  if (weeks.length === 0) return [];
  const max = Math.max(1, ...weeks.map((week) => week.count));
  const slot = size.width / weeks.length;
  const gap = Math.min(4, slot * 0.2);
  return weeks.map((week, index) => {
    const height = (week.count / max) * size.height;
    return {
      weekStart: week.weekStart,
      count: week.count,
      x: index * slot + gap / 2,
      y: size.height - height,
      width: Math.max(1, slot - gap),
      height,
    };
  });
}

export interface AreaShape {
  readonly category: StatusCategory;
  readonly path: string;
}

/**
 * Stacked areas, one per category in `CFD_ORDER`, sharing one vertical scale (the total
 * number of tasks on the busiest day). Each path closes back along the band below it.
 */
export function cumulativeFlowAreas(
  days: readonly FlowDayDto[],
  size: ChartSize,
): AreaShape[] {
  if (days.length === 0) return [];
  const totals = days.map((day) =>
    CFD_ORDER.reduce((sum, category) => sum + (day.counts[category] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const step = days.length > 1 ? size.width / (days.length - 1) : 0;
  const y = (value: number) => size.height - (value / max) * size.height;
  const point = (index: number, value: number) =>
    `${(index * step).toFixed(1)},${y(value).toFixed(1)}`;

  const floor = days.map(() => 0);
  return CFD_ORDER.map((category) => {
    const ceiling = days.map(
      (day, index) => (floor[index] ?? 0) + (day.counts[category] ?? 0),
    );
    const top = ceiling.map((value, index) => point(index, value)).join(" L");
    const bottom = floor
      .map((value, index) => point(index, value))
      .reverse()
      .join(" L");
    const path = `M${top} L${bottom} Z`;
    for (let index = 0; index < floor.length; index++)
      floor[index] = ceiling[index] ?? 0;
    return { category, path };
  });
}

export interface AgingDot {
  readonly item: AgingItemDto;
  readonly cx: number;
  readonly cy: number;
}

export interface AgingLine {
  readonly label: string;
  readonly days: number;
  readonly y: number;
}

export interface AgingChart {
  readonly maxDays: number;
  readonly columns: { readonly category: StatusCategory; readonly x: number }[];
  readonly dots: AgingDot[];
  readonly lines: AgingLine[];
}

/**
 * Aging work in progress: one lane per started column, a dot per item at its age, and
 * the cycle-time percentiles as reference lines on the same scale.
 */
export function agingChart(
  items: readonly AgingItemDto[],
  percentiles: {
    readonly p50: number | null;
    readonly p85: number | null;
    readonly p95: number | null;
  },
  size: ChartSize,
): AgingChart {
  const references: { readonly label: string; readonly days: number }[] = [];
  for (const [label, days] of [
    ["50th", percentiles.p50],
    ["85th", percentiles.p85],
    ["95th", percentiles.p95],
  ] as const) {
    if (days !== null) references.push({ label, days });
  }
  const maxDays = Math.max(
    1,
    ...items.map((item) => item.ageDays),
    ...references.map((reference) => reference.days),
  );
  const y = (days: number) => size.height - (days / maxDays) * size.height;
  const lane = size.width / AGING_CATEGORIES.length;
  const columns = AGING_CATEGORIES.map((category, index) => ({
    category,
    x: lane * index + lane / 2,
  }));
  const perLane = new Map<StatusCategory, number>();
  const dots = items.map((item) => {
    const column = columns.find((candidate) => candidate.category === item.category);
    const seen = perLane.get(item.category) ?? 0;
    perLane.set(item.category, seen + 1);
    // Spread items in the same lane sideways so equal ages do not hide each other.
    const offset = ((seen % 5) - 2) * Math.min(10, lane / 8);
    return { item, cx: (column?.x ?? lane / 2) + offset, cy: y(item.ageDays) };
  });
  return {
    maxDays,
    columns,
    dots,
    lines: references.map(({ label, days }) => ({ label, days, y: y(days) })),
  };
}
