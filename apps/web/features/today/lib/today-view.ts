import type {
  TaskDto,
  TodayEntryDto,
  TodayReason,
  TodaySectionDto,
  TodayViewResponse,
} from "@morrowlist/contracts";

/** Labels for the three Today sections and their badges (spec 9.2). */
export const TODAY_SECTION_LABELS: Record<TodayReason, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  my_day: "My Day",
};

/** The browser's calendar date; a stand-in until a Today response says the real one. */
export function localToday(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Long-form heading for a plain date, e.g. "Thursday, 3 September 2026". */
export function formatDateHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function countTodayTasks(view: TodayViewResponse): number {
  return view.data.sections.reduce((total, section) => total + section.tasks.length, 0);
}

function plannedFor(task: TaskDto, date: string): boolean {
  return task.dayPlans.includes(date);
}

function belongsToday(task: TaskDto, date: string): TodayReason | null {
  if (task.isCompleted || task.deletedAt !== null) return null;
  if (task.dueDate !== null && task.dueDate < date) return "overdue";
  if (task.dueDate === date) return "due_today";
  if (plannedFor(task, date)) return "my_day";
  return null;
}

/**
 * Apply one authoritative or optimistic task to a cached Today projection so an inline
 * action lands at once (spec 23.3). This is a cache patch, not the rule: the server's
 * `todaySections` is re-read right after, and it decides the final placement.
 */
export function patchTaskInToday(
  view: TodayViewResponse,
  task: TaskDto,
): TodayViewResponse {
  const { date } = view.data;
  const section = belongsToday(task, date);
  const wasListed = view.data.sections.some((candidate) =>
    candidate.tasks.some((entry) => entry.task.id === task.id),
  );

  const sections: TodaySectionDto[] = view.data.sections.map((candidate) => {
    const kept = candidate.tasks.flatMap((entry): TodayEntryDto[] => {
      if (entry.task.id !== task.id) return [entry];
      if (section === null) return [];
      const reasons: TodayReason[] = entry.reasons.filter((r) => r !== "my_day");
      if (plannedFor(task, date)) reasons.push("my_day");
      // A task that lost every reason is dropped; the refetch settles any re-homing.
      return reasons.length === 0 ? [] : [{ task, reasons }];
    });
    if (wasListed || section !== candidate.id) return { ...candidate, tasks: kept };
    const reasons: TodayReason[] = [section];
    if (section !== "my_day" && plannedFor(task, date)) reasons.push("my_day");
    return { ...candidate, tasks: [...kept, { task, reasons }] };
  });

  const review = view.data.review
    ? {
        ...view.data.review,
        tasks: view.data.review.tasks.flatMap((candidate) =>
          candidate.id !== task.id
            ? [candidate]
            : task.isCompleted || task.deletedAt !== null || plannedFor(task, date)
              ? []
              : [task],
        ),
      }
    : null;

  return {
    ...view,
    data: {
      ...view.data,
      sections,
      review: review && review.tasks.length === 0 ? null : review,
    },
  };
}
