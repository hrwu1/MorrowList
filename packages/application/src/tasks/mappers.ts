import type { TaskDto } from "@morrowlist/contracts";
import { isCompleted, taskKey, type Task } from "@morrowlist/domain";

/**
 * Domain-to-contract mapping (spec 17.3 step 8). Keeping this in one place means a
 * transport change cannot quietly alter what the domain exposes.
 */
export function toTaskDto(
  task: Task,
  taskKeyPrefix: string,
  dayPlans: readonly string[] = [],
): TaskDto {
  return {
    id: task.id,
    key: taskKey(taskKeyPrefix, task.taskNumber),
    workspaceId: task.workspaceId,
    taskNumber: task.taskNumber,
    projectId: task.projectId,
    statusId: task.statusId,
    title: task.title,
    descriptionMd: task.descriptionMd,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    dueTimezone: task.dueTimezone,
    parentTaskId: task.parentTaskId,
    rank: task.rank,
    isCompleted: isCompleted(task),
    completedAt: task.completedAt?.toISOString() ?? null,
    version: task.version,
    createdBy: { kind: task.createdBy.kind, id: task.createdBy.id },
    lastActor: { kind: task.lastActor.kind, id: task.lastActor.id },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
    dayPlans: [...dayPlans],
  };
}
