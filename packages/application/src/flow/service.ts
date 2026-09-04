import type { FlowQuery, FlowSummaryDto } from "@morrowlist/contracts";
import {
  DAY_MS,
  DomainError,
  addDays,
  ageOf,
  agingWip,
  cumulativeFlow,
  cycleTime,
  doneAt,
  intervalsByTask,
  isOpenWork,
  currentRun,
  leadTime,
  percentiles,
  startedAt,
  systemClock,
  throughputByWeek,
  toLocalDate,
  type Clock,
  type StatusInterval,
} from "@morrowlist/domain";

import type { TransactionContext, UnitOfWork } from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";

import { toDays, toFlowPercentiles } from "./mappers.js";

/**
 * Flow metrics query (GAP-17). One read of the project's status intervals, then the
 * domain computes cycle time, lead time, throughput, WIP, the cumulative flow diagram and
 * the aging work in progress. Read-only: nothing here writes.
 */

export interface FlowServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export class FlowService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: FlowServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async project(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    query: FlowQuery,
  ): Promise<FlowSummaryDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const project = await tx.projects.findById(workspaceId, projectId);
      if (!project || project.archivedAt !== null) {
        throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
      }

      const now = this.clock.now();
      const days = Number(query.range);
      const to = toLocalDate(now, workspace.timezone);
      const from = addDays(to, -(days - 1));
      const since = new Date(now.getTime() - days * DAY_MS);

      const intervals = await tx.statusIntervals.listForProject(
        workspaceId,
        projectId,
        since,
      );
      const byTask = intervalsByTask(intervals);

      const cycleTimes: number[] = [];
      const leadTimes: number[] = [];
      const completions: Date[] = [];
      let wip = 0;
      for (const taskIntervals of byTask.values()) {
        const run = currentRun(taskIntervals);
        if (isOpenWork(run) && startedAt(run) !== null) wip += 1;
        const done = doneAt(run);
        if (done === null || done.getTime() < since.getTime()) continue;
        completions.push(done);
        const cycle = cycleTime(taskIntervals);
        if (cycle !== null) cycleTimes.push(cycle);
        const lead = leadTime(taskIntervals);
        if (lead !== null) leadTimes.push(lead);
      }
      const cycleReference = percentiles(cycleTimes);

      // Aging items are cards on the board, so the bounded board read names them.
      const board = await tx.tasks.listBoard({
        workspaceId,
        projectId,
        includeSubtasks: true,
      });
      const tasksById = new Map(board.items.map((task) => [task.id, task]));
      const statuses = new Map(
        (await tx.statuses.listByProject(projectId, { includeArchived: true })).map(
          (status) => [status.id, status],
        ),
      );
      const aging = agingWip(intervals, now, cycleReference).flatMap((item) => {
        const task = tasksById.get(item.taskId);
        if (!task) return [];
        return [
          {
            taskId: item.taskId,
            key: `${workspace.taskKeyPrefix}-${task.taskNumber}`,
            title: task.title,
            statusId: item.statusId,
            statusName: statuses.get(item.statusId)?.name ?? "Unknown",
            category: item.category,
            ageDays: toDays(item.age),
            band: item.band,
          },
        ];
      });

      return {
        projectId,
        range: query.range,
        from,
        to,
        timezone: workspace.timezone,
        computedAt: now.toISOString(),
        wip,
        completed: completions.length,
        cycleTimeDays: toFlowPercentiles(cycleTimes.length, cycleReference),
        leadTimeDays: toFlowPercentiles(leadTimes.length, percentiles(leadTimes)),
        throughput: throughputByWeek(completions, { from, to }, workspace.timezone),
        cumulativeFlow: cumulativeFlow(intervals, { from, to }, workspace.timezone),
        aging,
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

/** Per-card flow fields for a board read: one interval query for the whole board. */
export async function cardFlowFields(
  tx: TransactionContext,
  workspaceId: string,
  taskIds: readonly string[],
  now: Date,
): Promise<
  ReadonlyMap<string, { inStatusSince: Date | null; ageDays: number | null }>
> {
  const intervals: readonly StatusInterval[] = await tx.statusIntervals.listForTasks(
    workspaceId,
    taskIds,
  );
  const result = new Map<
    string,
    { inStatusSince: Date | null; ageDays: number | null }
  >();
  for (const [taskId, taskIntervals] of intervalsByTask(intervals)) {
    const open = taskIntervals.find((interval) => interval.leftAt === null);
    const age = ageOf(taskIntervals, now);
    result.set(taskId, {
      inStatusSince: open?.enteredAt ?? null,
      ageDays: age === null ? null : toDays(age),
    });
  }
  return result;
}
