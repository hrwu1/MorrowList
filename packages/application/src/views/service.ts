import type {
  BoardPlacementDto,
  BoardViewQuery,
  BoardViewResponse,
  TodayViewQuery,
  TodayViewResponse,
  UpcomingViewQuery,
  UpcomingViewResponse,
} from "@morrowlist/contracts";
import {
  DomainError,
  ValidationError,
  addDays,
  systemClock,
  toLocalDate,
  toPlainDate,
  todaySections,
  upcomingGroups,
  type Clock,
  type PlainDate,
  type Task,
  type WorkflowStatus,
} from "@morrowlist/domain";

import {
  buildLanes,
  categoryColumnForTask,
  categoryColumns,
  statusColumnKey,
  statusColumns,
} from "../board/index.js";
import {
  BOARD_TASK_LIMIT,
  UPCOMING_LIMIT,
  type TaskFilter,
  type TransactionContext,
  type UnitOfWork,
} from "../ports/index.js";
import { toProjectDto, toWorkflowStatusDto } from "../projects/mappers.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { loadTaskDtos, toTaskDto } from "../tasks/mappers.js";

export interface ViewServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export interface WorkspaceViewRequest {
  readonly workspaceId: string;
}

/**
 * Built-in view projections (spec 9.2, 9.3, 19.2 GetToday/GetUpcoming). Each is one
 * transaction with one bounded task read plus one day-plan read, so a view is a single
 * round trip from the client's point of view (spec 29.3).
 */
export class ViewService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: ViewServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async today(
    context: ActorContext,
    request: TodayViewQuery & WorkspaceViewRequest,
  ): Promise<TodayViewResponse> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.tasksRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, request.workspaceId);
      const today = toLocalDate(this.clock.now(), workspace.timezone);
      const date = request.date ? toPlainDate(request.date, "date") : today;

      const page = await tx.tasks.listToday({ workspaceId: workspace.id, date });
      // The review only makes sense for the current day: yesterday's unfinished manual
      // selections wait there until the user acts, and never roll forward (spec 9.2).
      const unfinished =
        date === today
          ? await tx.dayPlans.listUnfinished(workspace.id, addDays(date, -1))
          : [];

      const candidateIds = [...page.items, ...unfinished].map((task) => task.id);
      // My Day dates, subtask progress and tags each come from one query for the view.
      const [plans, progress, tags, edges] = await Promise.all([
        tx.dayPlans.listForTasks(candidateIds, date < today ? date : today),
        tx.tasks.childSummary(workspace.id, candidateIds),
        tx.tasks.tagsFor(workspace.id, candidateIds),
        tx.tasks.relationsFor(workspace.id, candidateIds),
      ]);
      const plannedFor = (task: Task, day: PlainDate) =>
        plans.get(task.id)?.includes(day) ?? false;
      const dto = (task: Task) =>
        toTaskDto(
          task,
          workspace.taskKeyPrefix,
          (plans.get(task.id) ?? []).filter((planDate) => planDate >= today),
          progress.get(task.id) ?? null,
          tags.get(task.id) ?? [],
          edges,
        );

      const planned = new Set(
        page.items.filter((task) => plannedFor(task, date)).map((task) => task.id),
      );
      const sections = todaySections(page.items, planned, date).map((section) => ({
        id: section.id,
        tasks: section.tasks.map((entry) => ({
          task: dto(entry.task),
          reasons: [...entry.reasons],
        })),
      }));

      const reviewTasks = unfinished.filter((task) => !plannedFor(task, date));
      return {
        data: {
          date,
          sections,
          review:
            reviewTasks.length === 0
              ? null
              : { date: addDays(date, -1), tasks: reviewTasks.map(dto) },
        },
      };
    });
  }

  async upcoming(
    context: ActorContext,
    request: UpcomingViewQuery & WorkspaceViewRequest,
  ): Promise<UpcomingViewResponse> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.tasksRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, request.workspaceId);
      const today = toLocalDate(this.clock.now(), workspace.timezone);
      const from = request.from ? toPlainDate(request.from, "from") : today;
      const horizonDays = request.horizon === "all" ? null : Number(request.horizon);
      const to = horizonDays === null ? null : addDays(from, horizonDays);

      const page = await tx.tasks.listUpcoming({
        workspaceId: workspace.id,
        from,
        to,
        limit: UPCOMING_LIMIT,
      });
      const taskIds = page.items.map((task) => task.id);
      const [plans, progress, tags, edges] = await Promise.all([
        tx.dayPlans.listForTasks(taskIds, today),
        tx.tasks.childSummary(workspace.id, taskIds),
        tx.tasks.tagsFor(workspace.id, taskIds),
        tx.tasks.relationsFor(workspace.id, taskIds),
      ]);

      return {
        data: {
          from,
          horizon: request.horizon,
          groups: upcomingGroups(page.items, from, horizonDays).map((group) => ({
            date: group.date,
            tasks: group.tasks.map((task) =>
              toTaskDto(
                task,
                workspace.taskKeyPrefix,
                plans.get(task.id) ?? [],
                progress.get(task.id) ?? null,
                tags.get(task.id) ?? [],
                edges,
              ),
            ),
          })),
          truncated: page.truncated,
        },
      };
    });
  }

  /**
   * Any saved view's filters, or Today, drawn as a board (spec 9.5, GAP-19).
   *
   * `ProjectService.board` is the same projection scoped to one project's workflow; this
   * one spans projects, so its columns are the semantic categories every workflow shares
   * (spec 11.3) and a drop into one resolves to the card's own project status on the way
   * back in (spec 11.5). Bounded like every board, and honest about being truncated.
   */
  async board(
    context: ActorContext,
    request: BoardViewQuery & WorkspaceViewRequest,
  ): Promise<BoardViewResponse> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.tasksRead);

    if (request.columnsBy === "status" && !request.projectId) {
      throw new ValidationError(
        "Status columns need a single project; boards across projects use categories.",
        { field: "columnsBy", columnsBy: request.columnsBy },
      );
    }

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, request.workspaceId);
      const today = toLocalDate(this.clock.now(), workspace.timezone);
      const date = request.date ? toPlainDate(request.date, "date") : today;
      const limit = Math.min(request.limit, BOARD_TASK_LIMIT);

      const page =
        request.source === "today"
          ? await tx.tasks.listToday({ workspaceId: workspace.id, date, limit })
          : await this.listBoardTasks(tx, workspace.id, request, today, limit);

      const projects = await tx.projects.listByWorkspace(workspace.id, {
        includeArchived: true,
      });
      const projectIds = [
        ...new Set(
          page.items.flatMap((task) => (task.projectId ? [task.projectId] : [])),
        ),
      ];
      const statusLists = await Promise.all(
        projectIds.map((projectId) =>
          tx.statuses.listByProject(projectId, { includeArchived: true }),
        ),
      );
      const statuses = new Map<string, WorkflowStatus>(
        statusLists.flat().map((status) => [status.id, status]),
      );

      const tasks = await loadTaskDtos(tx, workspace, page.items, today);
      const parentIds = [
        ...new Set(
          tasks.flatMap((task) => (task.parentTaskId ? [task.parentTaskId] : [])),
        ),
      ];
      const parents = await Promise.all(
        parentIds.map((id) => tx.tasks.findById(workspace.id, id)),
      );
      const active = projects.filter((project) => project.archivedAt === null);
      const { lanes, laneKeys } = buildLanes(request.swimlaneBy, tasks, {
        projects: active,
        parentTitles: new Map(
          parents.flatMap((parent) => (parent ? [[parent.id, parent.title]] : [])),
        ),
        today,
      });

      const columns =
        request.columnsBy === "status"
          ? statusColumns(
              statusLists
                .flat()
                .filter((status) => status.archivedAt === null)
                .sort((left, right) => (left.rank < right.rank ? -1 : 1))
                .map(toWorkflowStatusDto),
            )
          : categoryColumns();
      const columnKeys = new Set(columns.map((column) => column.key));
      const placements: BoardPlacementDto[] = tasks.flatMap((task) => {
        const columnKey =
          request.columnsBy === "status"
            ? task.statusId && statusColumnKey(task.statusId)
            : categoryColumnForTask(task, statuses);
        // A card sitting in an archived status has no cell of its own; it stays off the
        // board rather than being silently re-filed somewhere it was never put.
        if (!columnKey || !columnKeys.has(columnKey)) return [];
        return [
          { taskId: task.id, columnKey, laneKey: laneKeys.get(task.id) as string },
        ];
      });

      return {
        data: {
          source: request.source,
          columnsBy: request.columnsBy,
          swimlaneBy: request.swimlaneBy,
          columns,
          lanes: [...lanes],
          projects: active.map(toProjectDto),
          tasks,
          placements,
        },
        page: { hasMore: page.hasMore, truncated: page.truncated },
      };
    });
  }

  /** The saved view's filter set, always in manual rank order (ADR-009). */
  private async listBoardTasks(
    tx: TransactionContext,
    workspaceId: string,
    request: BoardViewQuery,
    today: PlainDate,
    limit: number,
  ): Promise<{
    items: readonly Task[];
    hasMore: boolean;
    truncated: boolean;
  }> {
    const filter: TaskFilter = {
      workspaceId,
      projectId: request.projectId,
      priority: request.priority,
      tagId: request.tagId,
      isCompleted: request.isCompleted,
      isBlocked: request.isBlocked,
      due: request.due,
      deferred: request.deferred,
      deadline: request.deadline,
      inboxOnly: request.inbox,
      includeSubtasks: request.includeSubtasks,
      today,
      sort: "rank",
      order: "asc",
    };
    const page = await tx.tasks.list(filter, { limit });
    return { items: page.items, hasMore: page.hasMore, truncated: page.hasMore };
  }

  private async requireWorkspace(tx: TransactionContext, workspaceId: string) {
    const workspace = await tx.workspaces.findById(workspaceId);
    if (!workspace) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
        workspaceId,
      });
    }
    return workspace;
  }
}
