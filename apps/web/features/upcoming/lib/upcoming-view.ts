import type {
  TaskDto,
  UpcomingGroupDto,
  UpcomingHorizon,
  UpcomingViewResponse,
} from "@morrowlist/contracts";
import { UPCOMING_HORIZONS } from "@morrowlist/contracts";

/** Horizon as URL state (spec 9.3): `/upcoming` is 14 days, `?horizon=all` everything. */
export const DEFAULT_HORIZON: UpcomingHorizon = "14";

export const HORIZON_LABELS: Record<UpcomingHorizon, string> = {
  "7": "Next 7 days",
  "14": "Next 14 days",
  "30": "Next 30 days",
  all: "All upcoming",
};

export function readHorizon(params: URLSearchParams): UpcomingHorizon {
  const value = params.get("horizon");
  return UPCOMING_HORIZONS.find((horizon) => horizon === value) ?? DEFAULT_HORIZON;
}

export function countUpcomingTasks(view: UpcomingViewResponse): number {
  return view.data.groups.reduce((total, group) => total + group.tasks.length, 0);
}

/** "Tomorrow", "Friday 11 September", or the full date once it is far enough away. */
export function formatGroupDate(date: string, from: string): string {
  if (date === addDays(from, 1)) return "Tomorrow";
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(year, month - 1, day));
  const withinWeek = date <= addDays(from, 6);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withinWeek ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(instant);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Apply one task to a cached Upcoming projection: it leaves its old date group and joins
 * the group for its new due date when that date is inside the view's horizon. A cache
 * patch only; the server's `upcomingGroups` is re-read straight after (spec 23.3).
 */
export function patchTaskInUpcoming(
  view: UpcomingViewResponse,
  task: TaskDto,
): UpcomingViewResponse {
  const { from, horizon } = view.data;
  const last = horizon === "all" ? null : addDays(from, Number(horizon));
  const belongs =
    !task.isCompleted &&
    task.deletedAt === null &&
    task.dueDate !== null &&
    task.dueDate > from &&
    (task.deferUntil === null || task.deferUntil <= from) &&
    (last === null || task.dueDate <= last);

  const without: UpcomingGroupDto[] = view.data.groups
    .map((group) => ({
      ...group,
      tasks: group.tasks.filter((candidate) => candidate.id !== task.id),
    }))
    .filter((group) => group.tasks.length > 0);

  if (!belongs || task.dueDate === null) {
    return { ...view, data: { ...view.data, groups: without } };
  }

  const dueDate = task.dueDate;
  const existing = without.find((group) => group.date === dueDate);
  const groups = existing
    ? without.map((group) =>
        group === existing ? { ...group, tasks: [...group.tasks, task] } : group,
      )
    : [...without, { date: dueDate, tasks: [task] }].sort((left, right) =>
        left.date < right.date ? -1 : 1,
      );

  return { ...view, data: { ...view.data, groups } };
}
