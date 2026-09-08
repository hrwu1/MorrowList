import type { BoardColumnDto, TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
import {
  DEFAULT_WORKFLOW,
  type StatusCategory,
  type WorkflowStatus,
} from "@morrowlist/domain";

/**
 * Board columns (spec 9.5, ADR-002): always workflow states, never another grouping.
 *
 * A board inside one project uses that project's statuses. A board spanning projects can
 * only use the semantic categories every workflow shares, because status names are the
 * project's own (spec 11.3) — two projects' "Doing" and "Active" are the same column
 * only because they are both `in_progress`.
 */

export function statusColumnKey(statusId: string): string {
  return `status:${statusId}`;
}

export function categoryColumnKey(category: StatusCategory): string {
  return `category:${category}`;
}

export function statusColumns(
  statuses: readonly WorkflowStatusDto[],
): BoardColumnDto[] {
  return statuses.map((status) => ({
    key: statusColumnKey(status.id),
    label: status.name,
    category: status.category,
    statusId: status.id,
    isTerminal: status.isTerminal,
    wipLimit: status.wipLimit,
    colorToken: status.colorToken,
  }));
}

/**
 * The six categories in workflow order, labelled and coloured like the default workflow
 * so a cross-project board reads like the project boards it summarises (spec 11.2).
 */
export function categoryColumns(): BoardColumnDto[] {
  return DEFAULT_WORKFLOW.map((template) => ({
    key: categoryColumnKey(template.category),
    label: template.name,
    category: template.category,
    statusId: null,
    isTerminal: template.category === "done",
    wipLimit: null,
    colorToken: template.colorToken,
  }));
}

/**
 * Which column a card falls in. An Inbox task has no workflow status at all (spec 9.1);
 * on a category board it sits in Backlog until it is completed, because "not started in
 * any workflow" is what Backlog means, and a completed one sits in Done like every other
 * finished task.
 */
export function categoryColumnForTask(
  task: TaskDto,
  statuses: ReadonlyMap<string, WorkflowStatus>,
): string {
  if (task.statusId !== null) {
    return categoryColumnKey(statuses.get(task.statusId)?.category ?? "backlog");
  }
  return categoryColumnKey(task.isCompleted ? "done" : "backlog");
}
