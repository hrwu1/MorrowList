import type { DayPlan, PlainDate, Task, WorkflowStatus } from "@morrowlist/domain";

import type {
  ActivityEvent,
  ActivityEventInput,
  ActivityRepository,
  AggregateType,
  Cursor,
  DayPlanRepository,
  OutboxEventInput,
  OutboxRepository,
  Page,
  Project,
  ProjectRepository,
  RankScope,
  TaskCounterRepository,
  TaskFilter,
  TaskRepository,
  TransactionContext,
  UnitOfWork,
  WorkflowStatusRepository,
  Workspace,
  WorkspaceMembership,
  WorkspaceRepository,
  WorkspaceRole,
} from "../ports/index.js";
import { BOARD_TASK_LIMIT, UPCOMING_LIMIT } from "../ports/tasks.js";

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
  workspaces: Map<string, Workspace>;
  memberships: WorkspaceMembership[];
  activity: ActivityEvent[];
  outbox: OutboxEventInput[];
}

export function emptyData(): InMemoryData {
  return {
    tasks: new Map(),
    counters: new Map(),
    dayPlans: new Map(),
    projects: new Map(),
    statuses: new Map(),
    workspaces: new Map(),
    memberships: [],
    activity: [],
    outbox: [],
  };
}

const PRIORITY_ORDER = ["none", "low", "medium", "high", "urgent"];

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
      let items = [...data.tasks.values()].filter(
        (task) => task.workspaceId === filter.workspaceId,
      );

      items = items.filter((t) =>
        filter.deletedOnly ? t.deletedAt !== null : t.deletedAt === null,
      );
      if (filter.inboxOnly) items = items.filter((t) => t.projectId === null);
      if (filter.projectId)
        items = items.filter((t) => t.projectId === filter.projectId);
      if (filter.statusId) items = items.filter((t) => t.statusId === filter.statusId);
      if (filter.parentTaskId) {
        items = items.filter((t) => t.parentTaskId === filter.parentTaskId);
      } else if (filter.includeSubtasks === false) {
        items = items.filter((t) => t.parentTaskId === null);
      }
      if (filter.priority) items = items.filter((t) => t.priority === filter.priority);
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
            task.statusId === null
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
            ((task.dueDate !== null && task.dueDate <= query.date) ||
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
            (query.to === null || task.dueDate <= query.to),
        )
        .sort(byDueThenRank);
      const hasMore = items.length > limit;
      return { items: items.slice(0, limit), hasMore, truncated: hasMore };
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
  };
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
        .filter((event) => event.workspaceId === workspaceId)
        .slice(0, limit);
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
    workspaces: new Map(source.workspaces),
    memberships: [...source.memberships],
    activity: [...source.activity],
    outbox: [...source.outbox],
  });

  const restore = (target: InMemoryData, source: InMemoryData): void => {
    target.tasks = source.tasks;
    target.counters = source.counters;
    target.dayPlans = source.dayPlans;
    target.projects = source.projects;
    target.statuses = source.statuses;
    target.workspaces = source.workspaces;
    target.memberships = source.memberships;
    target.activity = source.activity;
    target.outbox = source.outbox;
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
        workspaces: workspaceRepository(working),
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
