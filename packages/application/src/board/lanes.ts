import type {
  BoardLaneDto,
  BoardSwimlane,
  TagDto,
  TaskDto,
} from "@morrowlist/contracts";
import {
  DUE_BUCKETS,
  PRIORITIES,
  dueBucket,
  tagLookupKey,
  type PlainDate,
} from "@morrowlist/domain";

import type { Project } from "../ports/index.js";

/**
 * Swimlanes (spec 9.5, GAP-19).
 *
 * A lane is a projection over the cards a board already returned, never a second task
 * model (ADR-001) and never a container (ADR-002). The server decides every lane and
 * every card's lane, so the client renders what it is told and can be tested on it.
 *
 * A lane is writable when dropping a card into it is an ordinary mutation of the card:
 * its priority, its project, or its tags. Due buckets and parents are read-only pivots —
 * a due date is not something to infer from a drop, and re-parenting by drag is too
 * surprising to happen by accident.
 */

/** The single lane a board with no swimlane still reports, so one renderer covers both. */
export const ALL_LANE_KEY = "all";

const PRIORITY_LABELS: Record<TaskDto["priority"], string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

const DUE_LABELS: Record<(typeof DUE_BUCKETS)[number], string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Next 7 days",
  later: "Later",
  none: "No due date",
};

export interface LaneContext {
  /**
   * Every project a card on this board may belong to, archived ones included, so no card
   * is left without a lane. Also the projects a project lane is offered for.
   */
  readonly projects: readonly Project[];
  /** Titles for parent lanes; a parent outside the board still needs a label. */
  readonly parentTitles: ReadonlyMap<string, string>;
  readonly today: PlainDate;
}

export interface BoardLanes {
  readonly lanes: readonly BoardLaneDto[];
  /** Task id to lane key. Every task on the board has exactly one entry. */
  readonly laneKeys: ReadonlyMap<string, string>;
}

export function laneKeyFor(swimlaneBy: BoardSwimlane, value: string | null): string {
  if (swimlaneBy === "none") return ALL_LANE_KEY;
  return `${swimlaneBy}:${value ?? "none"}`;
}

export function buildLanes(
  swimlaneBy: BoardSwimlane,
  tasks: readonly TaskDto[],
  context: LaneContext,
): BoardLanes {
  const laneKeys = new Map<string, string>();
  for (const task of tasks) {
    const value = laneValueOf(swimlaneBy, task, context.today);
    laneKeys.set(task.id, laneKeyFor(swimlaneBy, value));
  }

  const counts = new Map<string, number>();
  for (const key of laneKeys.values()) counts.set(key, (counts.get(key) ?? 0) + 1);

  const lane = (
    value: string | null,
    label: string,
    writable: boolean,
    colorToken: string | null = null,
  ): BoardLaneDto => {
    const key = laneKeyFor(swimlaneBy, value);
    return { key, label, value, writable, colorToken, count: counts.get(key) ?? 0 };
  };
  const occupied = (row: BoardLaneDto) => counts.has(row.key);

  switch (swimlaneBy) {
    case "priority":
      // Every priority is offered even when empty: the lane is how a priority is set.
      return {
        lanes: [...PRIORITIES]
          .reverse()
          .map((priority) => lane(priority, PRIORITY_LABELS[priority], true)),
        laneKeys,
      };

    case "project": {
      const named = [...context.projects]
        .sort((left, right) =>
          left.name === right.name
            ? compare(left.id, right.id)
            : compare(left.name, right.name),
        )
        .map((project) => lane(project.id, project.name, true, project.colorToken));
      return { lanes: [lane(null, "Inbox", true), ...named], laneKeys };
    }

    case "tag": {
      const byId = new Map<string, TagDto>();
      for (const task of tasks) for (const tag of task.tags) byId.set(tag.id, tag);
      const named = [...byId.values()]
        .map((tag) => ({ tag, sortKey: tagLookupKey(tag.name) }))
        .sort((left, right) =>
          left.sortKey === right.sortKey
            ? compare(left.tag.id, right.tag.id)
            : compare(left.sortKey, right.sortKey),
        )
        .map(({ tag }) => tag)
        .map((tag) => lane(tag.id, tag.name, true, tag.colorToken))
        .filter(occupied);
      const untagged = lane(null, "No tag", false);
      return { lanes: occupied(untagged) ? [...named, untagged] : named, laneKeys };
    }

    case "due":
      return {
        lanes: DUE_BUCKETS.map((bucket) =>
          lane(bucket, DUE_LABELS[bucket], false),
        ).filter(occupied),
        laneKeys,
      };

    case "parent": {
      const parentIds = [
        ...new Set(
          tasks.flatMap((task) => (task.parentTaskId ? [task.parentTaskId] : [])),
        ),
      ];
      const named = parentIds
        .map((id) => ({ id, title: context.parentTitles.get(id) ?? "Another task" }))
        .sort((left, right) =>
          left.title === right.title
            ? compare(left.id, right.id)
            : compare(left.title, right.title),
        )
        .map(({ id, title }) => lane(id, title, false));
      const orphans = lane(null, "No parent", false);
      return { lanes: occupied(orphans) ? [...named, orphans] : named, laneKeys };
    }

    default:
      return { lanes: [lane(null, "All cards", false)], laneKeys };
  }
}

function laneValueOf(
  swimlaneBy: BoardSwimlane,
  task: TaskDto,
  today: PlainDate,
): string | null {
  switch (swimlaneBy) {
    case "priority":
      return task.priority;
    case "project":
      return task.projectId;
    case "tag":
      // Tags arrive in normalized-name order (spec 12.1), so "the first tag" is the same
      // choice on every request and for every reader.
      return task.tags[0]?.id ?? null;
    case "due":
      return dueBucket(task.dueDate as PlainDate | null, today);
    case "parent":
      return task.parentTaskId;
    default:
      return null;
  }
}

function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
