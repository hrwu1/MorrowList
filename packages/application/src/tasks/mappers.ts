import type { SubtaskProgress, TaskDto } from "@morrowlist/contracts";
import { isCompleted, taskKey, type Tag, type Task } from "@morrowlist/domain";

import { toTagDto } from "../tags/mappers.js";

/**
 * Domain-to-contract mapping (spec 17.3 step 8). Keeping this in one place means a
 * transport change cannot quietly alter what the domain exposes.
 *
 * `subtaskProgress` is a projection over the task's children (spec 8.3), so the caller
 * supplies it from one `childSummary` query for the whole page rather than per task.
 */
export function toTaskDto(
  task: Task,
  taskKeyPrefix: string,
  dayPlans: readonly string[] = [],
  subtaskProgress: SubtaskProgress | null = null,
  tags: readonly Tag[] = [],
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
    tags: tags.map(toTagDto),
    createdBy: { kind: task.createdBy.kind, id: task.createdBy.id },
    lastActor: { kind: task.lastActor.kind, id: task.lastActor.id },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
    dayPlans: [...dayPlans],
    subtaskProgress,
  };
}
