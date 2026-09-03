import type {
  TodayViewQuery,
  TodayViewResponse,
  UpcomingViewQuery,
  UpcomingViewResponse,
} from "@morrowlist/contracts";
import {
  DomainError,
  addDays,
  systemClock,
  toLocalDate,
  toPlainDate,
  todaySections,
  upcomingGroups,
  type Clock,
  type PlainDate,
  type Task,
} from "@morrowlist/domain";

import {
  UPCOMING_LIMIT,
  type TransactionContext,
  type UnitOfWork,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { toTaskDto } from "../tasks/mappers.js";

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
