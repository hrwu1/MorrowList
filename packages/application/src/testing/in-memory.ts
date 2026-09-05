import {
  addDays,
  childProgress,
  isBlocked,
  inProgressTasks,
  isDeferred,
  type DayPlan,
  type PlainDate,
  type Reminder,
  type StatusInterval,
  type Tag,
  type Task,
  type TaskRelation,
  type WorkflowStatus,
} from "@morrowlist/domain";

import type {
  ActivityEvent,
  ActivityEventInput,
  ActivityRepository,
  AggregateType,
  Cursor,
  DayPlanRepository,
  Notification,
  NotificationPreferenceRepository,
  NotificationPreferences,
  NotificationRepository,
  OutboxEventInput,
  OutboxRepository,
  Page,
  Project,
  ProjectRepository,
  PushSubscription,
  PushSubscriptionRepository,
  RankScope,
  RelationEdge,
  ReminderRepository,
  StatusIntervalInput,
  StatusIntervalRepository,
  SavedView,
  SavedViewRepository,
  TagRepository,
  TaskCounterRepository,
  TaskFilter,
  TaskRepository,
  TaskSearchQuery,
  TransactionContext,
  UnitOfWork,
  WorkflowStatusRepository,
  Workspace,
  WorkspaceMembership,
  WebhookDelivery,
  WebhookDeliveryRepository,
  WebhookSubscription,
  WebhookSubscriptionRepository,
  WorkspaceRepository,
  WorkspaceRole,
} from "../ports/index.js";
import { BLOCKS_WALK_DEPTH, BOARD_TASK_LIMIT, UPCOMING_LIMIT } from "../ports/tasks.js";

/**
 * In-memory adapters for the application ports.
 *
 * These exist so command logic — authorisation, policy sequencing, event recording — can
 * be tested at speed without a database. They are NOT a substitute for the integration
 * suite: SQL constraints, locking, and migrations are verified against real PostgreSQL.
 */

export interface InMemoryData {
  tasks: Map<string, Task>;
  counters: Map<string, number>;
  /** Keyed by `${taskId}:${planDate}`, mirroring the composite primary key. */
  dayPlans: Map<string, DayPlan>;
  projects: Map<string, Project>;
  statuses: Map<string, WorkflowStatus>;
  tags: Map<string, Tag>;
  savedViews: Map<string, SavedView>;
  taskTags: { taskId: string; tagId: string; createdAt: Date }[];
  relations: Map<string, TaskRelation>;
  intervals: InMemoryInterval[];
  workspaces: Map<string, Workspace>;
  memberships: WorkspaceMembership[];
  /** Keyed by task id: a task has at most one reminder. */
  reminders: Map<string, Reminder>;
  notifications: Map<string, Notification>;
  /** Keyed by `${userId}:${workspaceId}`. */
  notificationPreferences: Map<string, NotificationPreferences>;
  /** Keyed by `${userId}:${endpoint}`. */
  pushSubscriptions: Map<string, PushSubscription>;
  activity: ActivityEvent[];
  outbox: OutboxEventInput[];
  /** Outbox ids the dispatcher has finished with. */
  published: Map<string, Date>;
  webhookSubscriptions: Map<string, WebhookSubscription>;
  webhookDeliveries: Map<string, WebhookDelivery>;
}

/** A stored interval: the input plus the moment it was left. */
export type InMemoryInterval = StatusIntervalInput & { readonly leftAt: Date | null };

export function emptyData(): InMemoryData {
  return {
    tasks: new Map(),
    counters: new Map(),
    dayPlans: new Map(),
    projects: new Map(),
    statuses: new Map(),
    tags: new Map(),
    savedViews: new Map(),
    taskTags: [],
    relations: new Map(),
    intervals: [],
    workspaces: new Map(),
    memberships: [],
    reminders: new Map(),
    notifications: new Map(),
    notificationPreferences: new Map(),
    pushSubscriptions: new Map(),
    activity: [],
    outbox: [],
    published: new Map(),
    webhookSubscriptions: new Map(),
    webhookDeliveries: new Map(),
  };
}

/** Normalized name, then id: the same order the SQL repository's COLLATE "C" produces. */
function compareTags(left: Tag, right: Tag): number {
  if (left.normalizedName !== right.normalizedName) {
    return left.normalizedName < right.normalizedName ? -1 : 1;
  }
  return left.id < right.id ? -1 : 1;
}

const PRIORITY_ORDER = ["none", "low", "medium", "high", "urgent"];

/** The list predicate, shared by `list` and `search` so both read the same filters. */
function filterTasks(data: InMemoryData, filter: TaskFilter): Task[] {
  let items = [...data.tasks.values()].filter(
    (task) => task.workspaceId === filter.workspaceId,
  );

  items = items.filter((t) =>
    filter.deletedOnly ? t.deletedAt !== null : t.deletedAt === null,
  );
  if (filter.inboxOnly) items = items.filter((t) => t.projectId === null);
  if (filter.projectId) items = items.filter((t) => t.projectId === filter.projectId);
  if (filter.statusId) items = items.filter((t) => t.statusId === filter.statusId);
  if (filter.seriesId) items = items.filter((t) => t.seriesId === filter.seriesId);
  if (filter.parentTaskId) {
    items = items.filter((t) => t.parentTaskId === filter.parentTaskId);
  } else if (filter.includeSubtasks === false) {
    items = items.filter((t) => t.parentTaskId === null);
  }
  if (filter.priority) items = items.filter((t) => t.priority === filter.priority);
  if (filter.tagId) {
    const tagId = filter.tagId;
    items = items.filter((t) =>
      data.taskTags.some((link) => link.taskId === t.id && link.tagId === tagId),
    );
  }
  if (filter.isCompleted !== undefined) {
    items = items.filter((t) => (t.completedAt !== null) === filter.isCompleted);
  }
  if (filter.due && filter.today) {
    const today = filter.today;
    items = items.filter((task) => {
      switch (filter.due) {
        case "none":
          return task.dueDate === null;
        case "overdue":
          return task.dueDate !== null && task.dueDate < today;
        case "today":
          return task.dueDate === today;
        case "future":
          return task.dueDate !== null && task.dueDate > today;
        default:
          return true;
      }
    });
  }
  if (filter.deferred !== undefined && filter.today) {
    const today = filter.today as PlainDate;
    items = items.filter((task) => isDeferred(task, today) === filter.deferred);
  }
  if (filter.deadline && filter.today) {
    const today = filter.today as PlainDate;
    const weekEnd = addDays(today, 7);
    items = items.filter((task) => {
      switch (filter.deadline) {
        case "none":
          return task.deadline === null;
        case "overdue":
          return task.deadline !== null && task.deadline < today;
        case "week":
          return (
            task.deadline !== null && task.deadline >= today && task.deadline <= weekEnd
          );
        default:
          return true;
      }
    });
  }

  if (filter.isBlocked !== undefined) {
    items = items.filter((t) => blockedIn(data, t) === filter.isBlocked);
  }
  return items;
}

function taskRepository(data: InMemoryData): TaskRepository {
  const inScope = (task: Task, scope: RankScope) =>
    task.workspaceId === scope.workspaceId &&
    task.projectId === scope.projectId &&
    task.statusId === scope.statusId &&
    task.deletedAt === null;

  return {
    async findById(workspaceId, taskId) {
      const task = data.tasks.get(taskId);
      return task && task.workspaceId === workspaceId ? task : null;
    },
    async findByNumber(workspaceId, taskNumber) {
      return (
        [...data.tasks.values()].find(
          (task) => task.workspaceId === workspaceId && task.taskNumber === taskNumber,
        ) ?? null
      );
    },
    async list(filter: TaskFilter, cursor: Cursor): Promise<Page<Task>> {
      let items = filterTasks(data, filter);

      const direction = filter.order === "desc" ? -1 : 1;
      const key = (task: Task): string | number => {
        switch (filter.sort) {
          case "createdAt":
            return task.createdAt.getTime();
          case "updatedAt":
            return task.updatedAt.getTime();
          case "dueDate":
            return task.dueDate ?? "9999-12-31";
          case "priority":
            return PRIORITY_ORDER.indexOf(task.priority);
          default:
            return task.rank;
        }
      };
      items.sort((a, b) => {
        const left = key(a);
        const right = key(b);
        if (left === right) return a.id < b.id ? -1 : 1;
        return (left < right ? -1 : 1) * direction;
      });

      if (cursor.after) {
        const index = items.findIndex((task) => task.id === cursor.after);
        if (index >= 0) items = items.slice(index + 1);
      }

      const pageItems = items.slice(0, cursor.limit);
      return {
        items: pageItems,
        hasMore: items.length > cursor.limit,
        nextCursor: null,
      };
    },
    async search(query: TaskSearchQuery, cursor: Cursor): Promise<Page<Task>> {
      const words = (text: string | null) =>
        (text ?? "").toLocaleLowerCase("en-US").split(/[^\p{L}\p{N}]+/u);
      const hits = (text: string | null) =>
        query.terms.filter((term) => words(text).some((word) => word.startsWith(term)))
          .length;
      const tagHit = (task: Task) =>
        data.taskTags
          .filter((link) => link.taskId === task.id)
          .some((link) => {
            const name = data.tags.get(link.tagId)?.normalizedName ?? "";
            return query.terms.some((term) => name.startsWith(term));
          });
      // Mirrors the SQL order: title hits outrank description hits, a task matched only
      // through a tag name ranks zero, and the newest id breaks ties.
      const score = (task: Task) => hits(task.title) * 2 + hits(task.descriptionMd);
      let items = filterTasks(data, query).filter(
        (task) =>
          query.terms.length === 0 ||
          hits(`${task.title} ${task.descriptionMd ?? ""}`) === query.terms.length ||
          tagHit(task),
      );
      items.sort((a, b) => score(b) - score(a) || (a.id < b.id ? 1 : -1));
      if (cursor.after) {
        const index = items.findIndex((task) => task.id === cursor.after);
        if (index >= 0) items = items.slice(index + 1);
      }
      return {
        items: items.slice(0, cursor.limit),
        hasMore: items.length > cursor.limit,
        nextCursor: null,
      };
    },
    async listBoard(query) {
      const limit = Math.max(
        1,
        Math.min(query.limit ?? BOARD_TASK_LIMIT, BOARD_TASK_LIMIT),
      );
      const items = [...data.tasks.values()]
        .filter((task) => {
          if (
            task.workspaceId !== query.workspaceId ||
            task.projectId !== query.projectId ||
            task.deletedAt !== null ||
            task.statusId === null ||
            (!query.includeSubtasks && task.parentTaskId !== null) ||
            (!query.includeDeferred && query.today && isDeferred(task, query.today))
          ) {
            return false;
          }
          const status = data.statuses.get(task.statusId);
          return status?.projectId === query.projectId && status.archivedAt === null;
        })
        .sort((left, right) => {
          const leftStatus = data.statuses.get(
            left.statusId as string,
          ) as WorkflowStatus;
          const rightStatus = data.statuses.get(
            right.statusId as string,
          ) as WorkflowStatus;
          if (leftStatus.rank !== rightStatus.rank) {
            return leftStatus.rank < rightStatus.rank ? -1 : 1;
          }
          if (left.rank !== right.rank) return left.rank < right.rank ? -1 : 1;
          return left.id < right.id ? -1 : 1;
        });
      const hasMore = items.length > limit;
      return {
        items: items.slice(0, limit),
        hasMore,
        truncated: hasMore,
      };
    },
    async listToday(query) {
      const limit = Math.max(
        1,
        Math.min(query.limit ?? BOARD_TASK_LIMIT, BOARD_TASK_LIMIT),
      );
      const planned = new Set(
        [...data.dayPlans.values()]
          .filter((plan) => plan.planDate === query.date)
          .map((plan) => plan.taskId),
      );
      const items = [...data.tasks.values()]
        .filter(
          (task) =>
            task.workspaceId === query.workspaceId &&
            task.deletedAt === null &&
            task.completedAt === null &&
            ((task.dueDate !== null &&
              task.dueDate <= query.date &&
              !isDeferred(task, query.date)) ||
              planned.has(task.id)),
        )
        .sort(byDueThenRank);
      const hasMore = items.length > limit;
      return { items: items.slice(0, limit), hasMore, truncated: hasMore };
    },
    async listUpcoming(query) {
      const limit = Math.max(
        1,
        Math.min(query.limit ?? UPCOMING_LIMIT, UPCOMING_LIMIT),
      );
      const items = [...data.tasks.values()]
        .filter(
          (task) =>
            task.workspaceId === query.workspaceId &&
            task.deletedAt === null &&
            task.completedAt === null &&
            task.dueDate !== null &&
            task.dueDate > query.from &&
            !isDeferred(task, query.from) &&
            (query.to === null || task.dueDate <= query.to),
        )
        .sort(byDueThenRank);
      const hasMore = items.length > limit;
      return { items: items.slice(0, limit), hasMore, truncated: hasMore };
    },
    async listInStatus(workspaceId, statusId) {
      return [...data.tasks.values()]
        .filter(
          (task) => task.workspaceId === workspaceId && task.statusId === statusId,
        )
        .sort((a, b) =>
          a.rank === b.rank ? (a.id < b.id ? -1 : 1) : a.rank < b.rank ? -1 : 1,
        );
    },
    async listInProgress(workspaceId) {
      return inProgressTasks(
        [...data.tasks.values()].filter((task) => task.workspaceId === workspaceId),
        [...data.statuses.values()],
      ).sort((a, b) => {
        if (a.projectId !== b.projectId) {
          return (a.projectId ?? "") < (b.projectId ?? "") ? -1 : 1;
        }
        return a.rank === b.rank ? (a.id < b.id ? -1 : 1) : a.rank < b.rank ? -1 : 1;
      });
    },
    async insert(task) {
      data.tasks.set(task.id, task);
    },
    async update(task, previousVersion) {
      const current = data.tasks.get(task.id);
      if (!current || current.version !== previousVersion) return false;
      data.tasks.set(task.id, task);
      return true;
    },
    async hardDelete(_workspaceId, taskId) {
      data.tasks.delete(taskId);
      data.taskTags = data.taskTags.filter((link) => link.taskId !== taskId);
      for (const [id, relation] of data.relations) {
        if (relation.sourceTaskId === taskId || relation.targetTaskId === taskId) {
          data.relations.delete(id);
        }
      }
    },
    async firstRankIn(scope) {
      const ranks = [...data.tasks.values()]
        .filter((task) => inScope(task, scope))
        .map((task) => task.rank)
        .sort();
      return ranks[0] ?? null;
    },
    async lastRankIn(scope) {
      const ranks = [...data.tasks.values()]
        .filter((task) => inScope(task, scope))
        .map((task) => task.rank)
        .sort();
      return ranks.at(-1) ?? null;
    },
    async ranksOf(workspaceId, taskIds) {
      const result = new Map<string, string>();
      for (const id of taskIds) {
        const task = data.tasks.get(id);
        if (task && task.workspaceId === workspaceId) result.set(id, task.rank);
      }
      return result;
    },
    async ancestorIds(workspaceId, taskId) {
      const chain: string[] = [];
      let current = data.tasks.get(taskId);
      while (current?.parentTaskId) {
        const parent = data.tasks.get(current.parentTaskId);
        if (!parent || parent.workspaceId !== workspaceId) break;
        if (chain.includes(parent.id)) break;
        chain.push(parent.id);
        current = parent;
      }
      return chain;
    },
    async descendantDepth(workspaceId, taskId) {
      const depthBelow = (id: string, seen: Set<string>): number => {
        if (seen.has(id)) return 0;
        seen.add(id);
        const children = [...data.tasks.values()].filter(
          (task) => task.workspaceId === workspaceId && task.parentTaskId === id,
        );
        return children.length === 0
          ? 0
          : 1 + Math.max(...children.map((child) => depthBelow(child.id, seen)));
      };
      return depthBelow(taskId, new Set());
    },
    async childSummary(workspaceId, taskIds) {
      const result = new Map<string, ReturnType<typeof childProgress>>();
      for (const id of taskIds) {
        const progress = childProgress(
          [...data.tasks.values()].filter(
            (task) => task.workspaceId === workspaceId && task.parentTaskId === id,
          ),
        );
        if (progress.total > 0) result.set(id, progress);
      }
      return result;
    },
    async tagsFor(workspaceId, taskIds) {
      const result = new Map<string, readonly Tag[]>();
      for (const taskId of taskIds) {
        const tags = data.taskTags
          .filter((link) => link.taskId === taskId)
          .flatMap((link) => {
            const tag = data.tags.get(link.tagId);
            return tag && tag.workspaceId === workspaceId ? [tag] : [];
          })
          .sort(compareTags);
        if (tags.length > 0) result.set(taskId, tags);
      }
      return result;
    },
    async addTag(taskId, tagId, createdAt) {
      if (data.taskTags.some((l) => l.taskId === taskId && l.tagId === tagId)) return;
      data.taskTags.push({ taskId, tagId, createdAt });
    },
    async removeTag(taskId, tagId) {
      data.taskTags = data.taskTags.filter(
        (link) => !(link.taskId === taskId && link.tagId === tagId),
      );
    },
    async relationsFor(workspaceId, taskIds) {
      const wanted = new Set(taskIds);
      return [...data.relations.values()]
        .filter(
          (relation) =>
            relation.workspaceId === workspaceId &&
            (wanted.has(relation.sourceTaskId) || wanted.has(relation.targetTaskId)),
        )
        .sort((left, right) => {
          const byTime = left.createdAt.getTime() - right.createdAt.getTime();
          if (byTime !== 0) return byTime;
          return left.id < right.id ? -1 : 1;
        })
        .flatMap((relation): RelationEdge[] => {
          const source = data.tasks.get(relation.sourceTaskId);
          const target = data.tasks.get(relation.targetTaskId);
          return source && target ? [{ relation, source, target }] : [];
        });
    },
    async findRelation(workspaceId, relationId) {
      const relation = data.relations.get(relationId);
      return relation && relation.workspaceId === workspaceId ? relation : null;
    },
    async insertRelation(relation) {
      const duplicate = [...data.relations.values()].some(
        (existing) =>
          existing.sourceTaskId === relation.sourceTaskId &&
          existing.targetTaskId === relation.targetTaskId &&
          existing.type === relation.type,
      );
      if (duplicate) return false;
      data.relations.set(relation.id, relation);
      return true;
    },
    async deleteRelation(workspaceId, relationId) {
      const relation = data.relations.get(relationId);
      if (relation && relation.workspaceId === workspaceId) {
        data.relations.delete(relationId);
      }
    },
    async downstreamOf(workspaceId, taskId, type) {
      const seen = new Set<string>();
      let frontier = [taskId];
      for (let depth = 0; depth < BLOCKS_WALK_DEPTH && frontier.length > 0; depth++) {
        const next: string[] = [];
        for (const relation of data.relations.values()) {
          if (
            relation.workspaceId === workspaceId &&
            relation.type === type &&
            frontier.includes(relation.sourceTaskId) &&
            !seen.has(relation.targetTaskId)
          ) {
            seen.add(relation.targetTaskId);
            next.push(relation.targetTaskId);
          }
        }
        frontier = next;
      }
      return [...seen];
    },
  };
}

/** The live, incomplete `blocks` predecessors decide blocked state (spec 8.4). */
function blockedIn(data: InMemoryData, task: Task): boolean {
  const predecessors = [...data.relations.values()]
    .filter(
      (relation) => relation.type === "blocks" && relation.targetTaskId === task.id,
    )
    .flatMap((relation) => {
      const source = data.tasks.get(relation.sourceTaskId);
      return source ? [source] : [];
    });
  return isBlocked(task, predecessors);
}

function byDueThenRank(left: Task, right: Task): number {
  const leftDue = left.dueDate ?? "9999-12-31";
  const rightDue = right.dueDate ?? "9999-12-31";
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  if (left.rank !== right.rank) return left.rank < right.rank ? -1 : 1;
  return left.id < right.id ? -1 : 1;
}

function dayPlanKey(taskId: string, planDate: PlainDate): string {
  return `${taskId}:${planDate}`;
}

function dayPlanRepository(data: InMemoryData): DayPlanRepository {
  return {
    async insert(plan) {
      const key = dayPlanKey(plan.taskId, plan.planDate);
      if (data.dayPlans.has(key)) return false;
      data.dayPlans.set(key, plan);
      return true;
    },
    async delete(taskId, planDate) {
      return data.dayPlans.delete(dayPlanKey(taskId, planDate));
    },
    async listForTasks(taskIds, from) {
      const wanted = new Set(taskIds);
      const result = new Map<string, PlainDate[]>();
      for (const plan of data.dayPlans.values()) {
        if (!wanted.has(plan.taskId) || plan.planDate < from) continue;
        const dates = result.get(plan.taskId) ?? [];
        dates.push(plan.planDate);
        result.set(plan.taskId, dates.sort());
      }
      return result;
    },
    async listUnfinished(workspaceId, date) {
      return [...data.dayPlans.values()]
        .filter((plan) => plan.planDate === date && plan.source === "manual")
        .flatMap((plan) => {
          const task = data.tasks.get(plan.taskId);
          return task &&
            task.workspaceId === workspaceId &&
            task.deletedAt === null &&
            task.completedAt === null
            ? [task]
            : [];
        })
        .sort((left, right) => (left.rank < right.rank ? -1 : 1));
    },
  };
}

function tagRepository(data: InMemoryData): TagRepository {
  return {
    async findById(workspaceId, tagId) {
      const tag = data.tags.get(tagId);
      return tag && tag.workspaceId === workspaceId ? tag : null;
    },
    async findByNormalizedName(workspaceId, normalizedName) {
      return (
        [...data.tags.values()].find(
          (tag) =>
            tag.workspaceId === workspaceId && tag.normalizedName === normalizedName,
        ) ?? null
      );
    },
    async listByWorkspace(workspaceId) {
      return [...data.tags.values()]
        .filter((tag) => tag.workspaceId === workspaceId)
        .sort(compareTags);
    },
    async taskCounts(workspaceId) {
      const counts = new Map<string, number>();
      for (const link of data.taskTags) {
        const task = data.tasks.get(link.taskId);
        if (!task || task.workspaceId !== workspaceId || task.deletedAt !== null) {
          continue;
        }
        counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
      }
      return counts;
    },
    async insert(tag) {
      data.tags.set(tag.id, tag);
    },
    async update(tag) {
      if (!data.tags.has(tag.id)) return false;
      data.tags.set(tag.id, tag);
      return true;
    },
    async delete(workspaceId, tagId) {
      const tag = data.tags.get(tagId);
      if (!tag || tag.workspaceId !== workspaceId) return;
      data.tags.delete(tagId);
      // The SQL foreign key cascades; the double has to do it by hand.
      data.taskTags = data.taskTags.filter((link) => link.tagId !== tagId);
    },
  };
}

function statusIntervalRepository(data: InMemoryData): StatusIntervalRepository {
  const toInterval = (row: InMemoryInterval): StatusInterval => ({
    taskId: row.taskId,
    statusId: row.statusId,
    category: row.category,
    enteredAt: row.enteredAt,
    leftAt: row.leftAt,
  });
  const byTime = (left: InMemoryInterval, right: InMemoryInterval) =>
    left.taskId !== right.taskId
      ? left.taskId < right.taskId
        ? -1
        : 1
      : left.enteredAt.getTime() - right.enteredAt.getTime();

  return {
    async open(interval) {
      if (
        data.intervals.some((r) => r.taskId === interval.taskId && r.leftAt === null)
      ) {
        // Mirrors the partial unique index on (task_id) where left_at is null.
        throw new Error(`task ${interval.taskId} already has an open interval`);
      }
      data.intervals.push({ ...interval, leftAt: null });
    },
    async close(taskId, leftAt) {
      data.intervals = data.intervals.map((row) =>
        row.taskId === taskId && row.leftAt === null ? { ...row, leftAt } : row,
      );
    },
    async listForTasks(workspaceId, taskIds) {
      const wanted = new Set(taskIds);
      return data.intervals
        .filter((row) => row.workspaceId === workspaceId && wanted.has(row.taskId))
        .sort(byTime)
        .map(toInterval);
    },
    async listForProject(workspaceId, projectId, since) {
      const touched = new Set(
        data.intervals
          .filter(
            (row) =>
              row.projectId === projectId &&
              (row.leftAt === null || row.leftAt.getTime() >= since.getTime()),
          )
          .map((row) => row.taskId),
      );
      return data.intervals
        .filter(
          (row) =>
            row.workspaceId === workspaceId &&
            row.projectId === projectId &&
            touched.has(row.taskId),
        )
        .sort(byTime)
        .map(toInterval);
    },
  };
}

function savedViewRepository(data: InMemoryData): SavedViewRepository {
  return {
    async findById(workspaceId, viewId) {
      const view = data.savedViews.get(viewId);
      return view && view.workspaceId === workspaceId ? view : null;
    },
    async listForOwner(workspaceId, ownerUserId) {
      return [...data.savedViews.values()]
        .filter(
          (view) =>
            view.workspaceId === workspaceId && view.ownerUserId === ownerUserId,
        )
        .sort((a, b) =>
          a.rank !== b.rank ? (a.rank < b.rank ? -1 : 1) : a.id < b.id ? -1 : 1,
        );
    },
    async insert(view) {
      data.savedViews.set(view.id, view);
    },
    async update(view) {
      if (!data.savedViews.has(view.id)) return false;
      data.savedViews.set(view.id, view);
      return true;
    },
    async delete(workspaceId, viewId) {
      const view = data.savedViews.get(viewId);
      if (view && view.workspaceId === workspaceId) data.savedViews.delete(viewId);
    },
  };
}

function counterRepository(data: InMemoryData): TaskCounterRepository {
  return {
    async ensure(workspaceId) {
      if (!data.counters.has(workspaceId)) data.counters.set(workspaceId, 1);
    },

    async allocate(workspaceId) {
      const next = data.counters.get(workspaceId) ?? 1;
      data.counters.set(workspaceId, next + 1);
      return next;
    },
  };
}

function projectRepository(data: InMemoryData): ProjectRepository {
  return {
    async findById(workspaceId, projectId) {
      const project = data.projects.get(projectId);
      return project && project.workspaceId === workspaceId ? project : null;
    },
    async listByWorkspace(workspaceId, options) {
      return [...data.projects.values()]
        .filter(
          (project) =>
            project.workspaceId === workspaceId &&
            (options?.includeArchived || project.archivedAt === null),
        )
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async insert(project) {
      data.projects.set(project.id, project);
    },
    async update(project, previousVersion) {
      const current = data.projects.get(project.id);
      if (!current || current.version !== previousVersion) return false;
      data.projects.set(project.id, project);
      return true;
    },
  };
}

function statusRepository(data: InMemoryData): WorkflowStatusRepository {
  return {
    async findById(statusId) {
      return data.statuses.get(statusId) ?? null;
    },
    async listByProject(projectId, options) {
      return [...data.statuses.values()]
        .filter(
          (status) =>
            status.projectId === projectId &&
            (options?.includeArchived || status.archivedAt === null),
        )
        .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    },
    async insertMany(statuses) {
      for (const status of statuses) data.statuses.set(status.id, status);
    },
    async countTasks(statusId) {
      return [...data.tasks.values()].filter((task) => task.statusId === statusId)
        .length;
    },
    async update(status, previousVersion) {
      const current = data.statuses.get(status.id);
      if (!current || current.version !== previousVersion) return false;
      data.statuses.set(status.id, status);
      return true;
    },
  };
}

function workspaceRepository(data: InMemoryData): WorkspaceRepository {
  return {
    async findById(workspaceId) {
      return data.workspaces.get(workspaceId) ?? null;
    },
    async findBySlug(slug) {
      return [...data.workspaces.values()].find((w) => w.slug === slug) ?? null;
    },
    async listForUser(userId) {
      return data.memberships
        .filter((membership) => membership.userId === userId)
        .flatMap((membership) => {
          const workspace = data.workspaces.get(membership.workspaceId);
          return workspace
            ? [{ ...workspace, role: membership.role as WorkspaceRole }]
            : [];
        });
    },
    async insert(workspace) {
      data.workspaces.set(workspace.id, workspace);
    },
    async update(workspace, previousVersion) {
      const current = data.workspaces.get(workspace.id);
      if (!current || current.version !== previousVersion) return false;
      data.workspaces.set(workspace.id, workspace);
      return true;
    },
    async addMember(membership) {
      data.memberships.push(membership);
    },
    async findMembership(workspaceId, userId) {
      return (
        data.memberships.find(
          (m) => m.workspaceId === workspaceId && m.userId === userId,
        ) ?? null
      );
    },
    async listMembers(workspaceId) {
      return data.memberships.filter((m) => m.workspaceId === workspaceId);
    },
  };
}

function reminderRepository(data: InMemoryData): ReminderRepository {
  return {
    async upsert(reminder) {
      data.reminders.set(reminder.taskId, reminder);
    },
    async delete(taskId) {
      data.reminders.delete(taskId);
    },
    async findByTask(taskId) {
      return data.reminders.get(taskId) ?? null;
    },
    async claimDue(now, limit) {
      const due = [...data.reminders.values()]
        .filter((r) => r.deliveredAt === null && r.remindAt.getTime() <= now.getTime())
        .sort((a, b) => a.remindAt.getTime() - b.remindAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...r, deliveredAt: now }));
      for (const reminder of due) data.reminders.set(reminder.taskId, reminder);
      return due;
    },
  };
}

function notificationRepository(data: InMemoryData): NotificationRepository {
  const forUser = (workspaceId: string, userId: string) =>
    [...data.notifications.values()].filter(
      (n) => n.workspaceId === workspaceId && n.userId === userId,
    );
  return {
    async insert(notification) {
      data.notifications.set(notification.id, notification);
    },
    async findById(workspaceId, userId, notificationId) {
      const found = data.notifications.get(notificationId);
      return found && found.workspaceId === workspaceId && found.userId === userId
        ? found
        : null;
    },
    async list(workspaceId, userId, cursor, unreadOnly) {
      let items = forUser(workspaceId, userId)
        .filter((n) => !unreadOnly || n.readAt === null)
        .sort((left, right) => {
          const byTime = right.createdAt.getTime() - left.createdAt.getTime();
          if (byTime !== 0) return byTime;
          return left.id < right.id ? 1 : -1;
        });
      if (cursor.after) {
        const index = items.findIndex((n) => n.id === cursor.after);
        if (index >= 0) items = items.slice(index + 1);
      }
      return {
        items: items.slice(0, cursor.limit),
        hasMore: items.length > cursor.limit,
        nextCursor: null,
      };
    },
    async markRead(workspaceId, userId, notificationId, readAt) {
      const found = data.notifications.get(notificationId);
      if (!found || found.workspaceId !== workspaceId || found.userId !== userId) {
        return false;
      }
      if (found.readAt === null) data.notifications.set(found.id, { ...found, readAt });
      return true;
    },
    async countUnread(workspaceId, userId) {
      return forUser(workspaceId, userId).filter((n) => n.readAt === null).length;
    },
  };
}

function preferenceKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

function notificationPreferenceRepository(
  data: InMemoryData,
): NotificationPreferenceRepository {
  return {
    async find(userId, workspaceId) {
      return (
        data.notificationPreferences.get(preferenceKey(userId, workspaceId)) ?? null
      );
    },
    async upsert(preferences) {
      data.notificationPreferences.set(
        preferenceKey(preferences.userId, preferences.workspaceId),
        preferences,
      );
    },
    async listWithDigest() {
      return [...data.notificationPreferences.values()].filter(
        (p) => p.digestTime !== null,
      );
    },
    async claimDigest(userId, workspaceId, date) {
      const key = preferenceKey(userId, workspaceId);
      const current = data.notificationPreferences.get(key);
      if (!current) return false;
      if (current.lastDigestDate !== null && current.lastDigestDate >= date)
        return false;
      data.notificationPreferences.set(key, { ...current, lastDigestDate: date });
      return true;
    },
  };
}

function pushSubscriptionRepository(data: InMemoryData): PushSubscriptionRepository {
  return {
    async upsert(subscription) {
      data.pushSubscriptions.set(
        `${subscription.userId}:${subscription.endpoint}`,
        subscription,
      );
    },
    async delete(userId, endpoint) {
      return data.pushSubscriptions.delete(`${userId}:${endpoint}`);
    },
    async listForUser(userId) {
      return [...data.pushSubscriptions.values()].filter((s) => s.userId === userId);
    },
  };
}

function activityRepository(data: InMemoryData): ActivityRepository {
  /** Newest first on `(createdAt, id)`, then keyset-paged after the anchor id. */
  const page = (events: ActivityEvent[], cursor: Cursor): Page<ActivityEvent> => {
    let items = events.sort((left, right) => {
      const byTime = right.createdAt.getTime() - left.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return left.id < right.id ? 1 : -1;
    });
    if (cursor.after) {
      const index = items.findIndex((event) => event.id === cursor.after);
      if (index >= 0) items = items.slice(index + 1);
    }
    return {
      items: items.slice(0, cursor.limit),
      hasMore: items.length > cursor.limit,
      nextCursor: null,
    };
  };

  return {
    async append(event: ActivityEventInput) {
      data.activity.push(event);
    },
    async listForAggregate(
      workspaceId: string,
      aggregateType: AggregateType,
      aggregateId: string,
      cursor: Cursor,
    ) {
      return page(
        data.activity.filter(
          (event) =>
            event.workspaceId === workspaceId &&
            event.aggregateType === aggregateType &&
            event.aggregateId === aggregateId,
        ),
        cursor,
      );
    },
    async listForWorkspace(
      workspaceId: string,
      cursor: Cursor,
      aggregateTypes?: readonly AggregateType[],
    ) {
      return page(
        data.activity.filter(
          (event) =>
            event.workspaceId === workspaceId &&
            (!aggregateTypes ||
              aggregateTypes.length === 0 ||
              aggregateTypes.includes(event.aggregateType)),
        ),
        cursor,
      );
    },
    async listForProject(workspaceId: string, projectId: string, cursor: Cursor) {
      const taskIds = new Set(
        [...data.tasks.values()]
          .filter(
            (task) => task.workspaceId === workspaceId && task.projectId === projectId,
          )
          .map((task) => task.id),
      );
      return page(
        data.activity.filter(
          (event) =>
            event.workspaceId === workspaceId &&
            ((event.aggregateType === "project" && event.aggregateId === projectId) ||
              (event.aggregateType === "task" && taskIds.has(event.aggregateId))),
        ),
        cursor,
      );
    },
  };
}

function outboxRepository(data: InMemoryData): OutboxRepository {
  return {
    async enqueue(event) {
      data.outbox.push(event);
    },
    async listUnpublished(workspaceId, limit = 100) {
      return data.outbox
        .filter(
          (event) =>
            event.workspaceId === workspaceId && !data.published.has(event.id),
        )
        .slice(0, limit);
    },
    async listPending(now, limit) {
      return data.outbox
        .filter(
          (event) =>
            !data.published.has(event.id) && event.availableAt.getTime() <= now.getTime(),
        )
        .sort((left, right) => {
          const byTime = left.availableAt.getTime() - right.availableAt.getTime();
          return byTime !== 0 ? byTime : left.id < right.id ? -1 : 1;
        })
        .slice(0, limit);
    },
    async markPublished(ids, publishedAt) {
      for (const id of ids) data.published.set(id, publishedAt);
    },
  };
}

function webhookSubscriptionRepository(
  data: InMemoryData,
): WebhookSubscriptionRepository {
  const inWorkspace = (workspaceId: string) =>
    [...data.webhookSubscriptions.values()]
      .filter((subscription) => subscription.workspaceId === workspaceId)
      .sort((left, right) => (left.id < right.id ? -1 : 1));

  return {
    async insert(subscription) {
      data.webhookSubscriptions.set(subscription.id, subscription);
    },
    async update(subscription) {
      data.webhookSubscriptions.set(subscription.id, subscription);
    },
    async findById(workspaceId, id) {
      const found = data.webhookSubscriptions.get(id);
      return found && found.workspaceId === workspaceId ? found : null;
    },
    async list(workspaceId, cursor) {
      let items = inWorkspace(workspaceId);
      if (cursor.after) {
        const index = items.findIndex((item) => item.id === cursor.after);
        if (index >= 0) items = items.slice(index + 1);
      }
      return {
        items: items.slice(0, cursor.limit),
        hasMore: items.length > cursor.limit,
        nextCursor: null,
      };
    },
    async delete(workspaceId, id) {
      const found = data.webhookSubscriptions.get(id);
      if (!found || found.workspaceId !== workspaceId) return false;
      data.webhookSubscriptions.delete(id);
      for (const [key, delivery] of data.webhookDeliveries) {
        if (delivery.subscriptionId === id) data.webhookDeliveries.delete(key);
      }
      return true;
    },
    async listActive(workspaceId) {
      return inWorkspace(workspaceId).filter((subscription) => subscription.active);
    },
  };
}

function webhookDeliveryRepository(data: InMemoryData): WebhookDeliveryRepository {
  return {
    async insert(delivery) {
      data.webhookDeliveries.set(delivery.id, delivery);
    },
    async enqueueIfAbsent(delivery) {
      const exists = [...data.webhookDeliveries.values()].some(
        (candidate) =>
          candidate.subscriptionId === delivery.subscriptionId &&
          candidate.outboxEventId !== null &&
          candidate.outboxEventId === delivery.outboxEventId,
      );
      if (exists) return false;
      data.webhookDeliveries.set(delivery.id, delivery);
      return true;
    },
    async claimDue(now, limit) {
      const due = [...data.webhookDeliveries.values()]
        .filter(
          (delivery) =>
            delivery.status === "pending" &&
            delivery.nextAttemptAt !== null &&
            delivery.nextAttemptAt.getTime() <= now.getTime(),
        )
        .sort((left, right) => {
          const byTime =
            (left.nextAttemptAt?.getTime() ?? 0) - (right.nextAttemptAt?.getTime() ?? 0);
          return byTime !== 0 ? byTime : left.id < right.id ? -1 : 1;
        })
        .slice(0, limit);

      return due.map((delivery) => {
        // Claiming takes the attempt and clears the schedule, exactly as the SQL does.
        const claimed: WebhookDelivery = {
          ...delivery,
          attempt: delivery.attempt + 1,
          nextAttemptAt: null,
          updatedAt: now,
        };
        data.webhookDeliveries.set(claimed.id, claimed);
        const subscription = data.webhookSubscriptions.get(claimed.subscriptionId);
        const event = data.outbox.find(
          (candidate) => candidate.id === claimed.outboxEventId,
        );
        return {
          delivery: claimed,
          url: subscription?.url ?? "",
          secretHash: subscription?.secretHash ?? "",
          event: event
            ? {
                id: event.id,
                schemaVersion: event.schemaVersion,
                eventType: event.eventType,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                workspaceId: event.workspaceId,
                actor: event.actor,
                payload: event.payload,
                correlationId: event.correlationId,
                occurredAt: event.occurredAt,
              }
            : null,
        };
      });
    },
    async recordOutcome(outcome) {
      const current = data.webhookDeliveries.get(outcome.id);
      if (!current) return;
      data.webhookDeliveries.set(outcome.id, {
        ...current,
        status: outcome.status,
        responseCode: outcome.responseCode,
        error: outcome.error,
        nextAttemptAt: outcome.nextAttemptAt,
        deliveredAt: outcome.deliveredAt,
        // Only a manual retry restarts the budget, matching the SQL repository.
        attempt: outcome.resetAttempts ? 0 : current.attempt,
        updatedAt: outcome.updatedAt,
      });
    },
    async findById(workspaceId, id) {
      const found = data.webhookDeliveries.get(id);
      return found && found.workspaceId === workspaceId ? found : null;
    },
    async listForSubscription(workspaceId, subscriptionId, cursor) {
      let items = [...data.webhookDeliveries.values()]
        .filter(
          (delivery) =>
            delivery.workspaceId === workspaceId &&
            delivery.subscriptionId === subscriptionId,
        )
        .sort((left, right) => {
          const byTime = right.createdAt.getTime() - left.createdAt.getTime();
          return byTime !== 0 ? byTime : left.id < right.id ? 1 : -1;
        });
      if (cursor.after) {
        const index = items.findIndex((item) => item.id === cursor.after);
        if (index >= 0) items = items.slice(index + 1);
      }
      return {
        items: items.slice(0, cursor.limit),
        hasMore: items.length > cursor.limit,
        nextCursor: null,
      };
    },
    async outstandingEventIds(eventIds) {
      const wanted = new Set(eventIds);
      return [
        ...new Set(
          [...data.webhookDeliveries.values()]
            .filter(
              (delivery) =>
                delivery.status === "pending" &&
                delivery.outboxEventId !== null &&
                wanted.has(delivery.outboxEventId),
            )
            .map((delivery) => delivery.outboxEventId as string),
        ),
      ];
    },
  };
}

export interface InMemoryUnitOfWork extends UnitOfWork {
  readonly data: InMemoryData;
  /** Force the next `execute` to fail after the callback runs, to prove rollback. */
  failNextCommit(error?: Error): void;
}

/**
 * A unit of work with real rollback semantics: the callback operates on a snapshot, which
 * is discarded if the callback throws. Without this, a test could pass while the command
 * left a half-written activity trail behind.
 */
export function createInMemoryUnitOfWork(
  seed: InMemoryData = emptyData(),
): InMemoryUnitOfWork {
  const data = seed;
  let pendingFailure: Error | null = null;

  const snapshot = (source: InMemoryData): InMemoryData => ({
    tasks: new Map(source.tasks),
    counters: new Map(source.counters),
    dayPlans: new Map(source.dayPlans),
    projects: new Map(source.projects),
    statuses: new Map(source.statuses),
    tags: new Map(source.tags),
    savedViews: new Map(source.savedViews),
    taskTags: [...source.taskTags],
    relations: new Map(source.relations),
    intervals: [...source.intervals],
    workspaces: new Map(source.workspaces),
    memberships: [...source.memberships],
    reminders: new Map(source.reminders),
    notifications: new Map(source.notifications),
    notificationPreferences: new Map(source.notificationPreferences),
    pushSubscriptions: new Map(source.pushSubscriptions),
    activity: [...source.activity],
    outbox: [...source.outbox],
    published: new Map(source.published),
    webhookSubscriptions: new Map(source.webhookSubscriptions),
    webhookDeliveries: new Map(source.webhookDeliveries),
  });

  const restore = (target: InMemoryData, source: InMemoryData): void => {
    target.tasks = source.tasks;
    target.counters = source.counters;
    target.dayPlans = source.dayPlans;
    target.projects = source.projects;
    target.statuses = source.statuses;
    target.tags = source.tags;
    target.savedViews = source.savedViews;
    target.taskTags = source.taskTags;
    target.relations = source.relations;
    target.intervals = source.intervals;
    target.workspaces = source.workspaces;
    target.memberships = source.memberships;
    target.reminders = source.reminders;
    target.notifications = source.notifications;
    target.notificationPreferences = source.notificationPreferences;
    target.pushSubscriptions = source.pushSubscriptions;
    target.activity = source.activity;
    target.outbox = source.outbox;
    target.published = source.published;
    target.webhookSubscriptions = source.webhookSubscriptions;
    target.webhookDeliveries = source.webhookDeliveries;
  };

  return {
    get data() {
      return data;
    },
    failNextCommit(error = new Error("simulated commit failure")) {
      pendingFailure = error;
    },
    async execute<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      const before = snapshot(data);
      const working = snapshot(data);
      const tx: TransactionContext = {
        tasks: taskRepository(working),
        taskCounters: counterRepository(working),
        dayPlans: dayPlanRepository(working),
        projects: projectRepository(working),
        statuses: statusRepository(working),
        tags: tagRepository(working),
        statusIntervals: statusIntervalRepository(working),
        savedViews: savedViewRepository(working),
        workspaces: workspaceRepository(working),
        reminders: reminderRepository(working),
        notifications: notificationRepository(working),
        notificationPreferences: notificationPreferenceRepository(working),
        pushSubscriptions: pushSubscriptionRepository(working),
        webhookSubscriptions: webhookSubscriptionRepository(working),
        webhookDeliveries: webhookDeliveryRepository(working),
        activity: activityRepository(working),
        outbox: outboxRepository(working),
      };

      try {
        const result = await fn(tx);
        if (pendingFailure) {
          const failure = pendingFailure;
          pendingFailure = null;
          throw failure;
        }
        restore(data, working);
        return result;
      } catch (error) {
        restore(data, before);
        throw error;
      }
    },
  };
}
