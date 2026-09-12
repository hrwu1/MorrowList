import type {
  BatchTasksResult,
  TaskCommandResult,
  TaskDto,
  WipWarningDto,
} from "@morrowlist/contracts";

/** Keep command metadata intact while ordinary field edits can still return a TaskDto. */
export type TaskMutationResult = TaskDto | TaskCommandResult;
export type TaskFeedbackResult = TaskMutationResult | BatchTasksResult | void;

export function taskFromResult(result: TaskMutationResult): TaskDto {
  return "task" in result ? result.task : result;
}

export function tasksFromResult(result: TaskFeedbackResult): readonly TaskDto[] {
  if (!result) return [];
  if ("data" in result) return result.data.map((entry) => entry.data);
  return [taskFromResult(result)];
}

export function warningsFromResult(
  result: TaskFeedbackResult,
): readonly WipWarningDto[] {
  return result && "warnings" in result ? result.warnings : [];
}
