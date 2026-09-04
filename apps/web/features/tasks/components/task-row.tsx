"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Priority, TaskDto } from "@morrowlist/contracts";
import { Button } from "@morrowlist/ui";
import Link from "next/link";
import { useId, useState } from "react";

import {
  useAddToDay,
  useCompleteTask,
  useDeleteTask,
  useRemoveFromDay,
  useReopenTask,
  useRestoreTask,
  useUpdateTask,
} from "../hooks/use-tasks";
import type { TaskDragData } from "../lib/task-dnd";
import { hasOpenSubtasks } from "../lib/task-projections";

import {
  DeadlineBadge,
  DeferBadge,
  DueBadge,
  DueDateInput,
  MyDayBadge,
  PriorityBadge,
  PrioritySelect,
  RepeatBadge,
  SubtaskProgressBadge,
} from "./task-fields";

import { BlockedBadge } from "@/features/relations/components/blocked-badge";
import { blockedSummary } from "@/features/relations/lib/relations";
import { TagChips } from "@/features/tags/components/tag-chip";

/**
 * A task row and its inline actions (VIEW-001, spec 9.1).
 *
 * The actions live behind a disclosure button that is always visible and always in the
 * tab order. A hover-only affordance is unreachable by keyboard and invisible on touch,
 * which spec 14 rules out; a disclosure is also simpler to get right than a menu widget,
 * and `aria-expanded` tells assistive technology everything it needs to know.
 */

export interface TaskRowProps {
  readonly task: TaskDto;
  /** Where the row's title links to; omitted in Trash, where detail cannot be loaded. */
  readonly detailHref?: string | undefined;
  readonly selected?: boolean | undefined;
  /** The workspace's calendar date, when the view knows it (Today and Upcoming). */
  readonly today?: string | undefined;
}

export function TaskRow({ task, detailHref, selected, today }: TaskRowProps) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const remove = useDeleteTask();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  // A row can be dragged onto a project in the sidebar, the same way a board card can.
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task } satisfies TaskDragData,
  });

  const busy = complete.isPending || reopen.isPending || remove.isPending;

  return (
    <li
      ref={setNodeRef}
      className="task-row"
      data-busy={busy || undefined}
      data-done={task.isCompleted || undefined}
      data-dragging={isDragging || undefined}
      aria-current={selected ? "true" : undefined}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button, select, input, textarea")) {
          return;
        }
        listeners?.onPointerDown?.(event);
      }}
    >
      <div className="task-row__main">
        <button
          type="button"
          className="task-row__check"
          onClick={() => {
            if (task.isCompleted) return reopen.mutate(task);
            // A blocked task is warned about first (spec 8.4), and completing a parent
            // leaves its open children as they are (spec 8.3).
            if (task.isBlocked && !window.confirm(blockedWarning(task))) return;
            if (hasOpenSubtasks(task) && !window.confirm(openSubtasksWarning(task))) {
              return;
            }
            complete.mutate(task);
          }}
          disabled={busy}
          // The label names the task, so the control is unambiguous out of context.
          aria-label={`${task.isCompleted ? "Reopen" : "Complete"} ${task.title}`}
          aria-pressed={task.isCompleted}
        >
          <span aria-hidden="true">{task.isCompleted ? "✓" : ""}</span>
        </button>

        <div className="task-row__body">
          {detailHref ? (
            <Link
              className="task-row__title"
              href={detailHref}
              // The list uses this to return focus here when the panel closes (spec 14).
              id={`task-link-${task.key}`}
            >
              {task.title}
            </Link>
          ) : (
            <span className="task-row__title">{task.title}</span>
          )}
          <span className="task-row__meta">
            <span className="task-row__key">{task.key}</span>
            <PriorityBadge priority={task.priority} />
            <DueBadge
              dueDate={task.dueDate}
              dueTime={task.dueTime}
              isCompleted={task.isCompleted}
              today={today}
            />
            <RepeatBadge recurrence={task.recurrence} />
            <DeadlineBadge
              deadline={task.deadline}
              deadlineTime={task.deadlineTime}
              isCompleted={task.isCompleted}
              today={today}
            />
            <DeferBadge deferUntil={task.deferUntil} today={today} />
            <MyDayBadge dayPlans={task.dayPlans} />
            <BlockedBadge task={task} />
            <SubtaskProgressBadge progress={task.subtaskProgress} />
            {task.completedAt ? (
              <time dateTime={task.completedAt}>
                Completed {new Date(task.completedAt).toLocaleDateString()}
              </time>
            ) : null}
          </span>
          <TagChips tags={task.tags} />
        </div>

        <Button
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={panelId}
          // The visible word is enough beside its row; out of context the name has to
          // say which task it edits (spec 14).
          aria-label={`Edit ${task.title}`}
          onClick={() => setExpanded((current) => !current)}
        >
          Edit
        </Button>
      </div>

      {expanded ? (
        <RowActions id={panelId} task={task} onDelete={() => remove.mutate(task)} />
      ) : null}
    </li>
  );
}

export function blockedWarning(task: TaskDto): string {
  return `"${task.title}" is blocked: ${blockedSummary(task)}. Complete it anyway?`;
}

export function openSubtasksWarning(task: TaskDto): string {
  const progress = task.subtaskProgress ?? { completed: 0, total: 0 };
  const open = progress.total - progress.completed;
  return `${open} of ${progress.total} subtasks are still open. Complete "${task.title}" anyway? The subtasks stay as they are.`;
}

function RowActions({
  id,
  task,
  onDelete,
}: {
  readonly id: string;
  readonly task: TaskDto;
  readonly onDelete: () => void;
}) {
  const update = useUpdateTask();
  const addToDay = useAddToDay();
  const removeFromDay = useRemoveFromDay();
  const inMyDay = task.dayPlans.length > 0;

  return (
    <div className="task-row__actions" id={id}>
      <div className="task-row__action">
        <label className="ml-field__label" htmlFor={`${id}-priority`}>
          Priority
        </label>
        <PrioritySelect
          id={`${id}-priority`}
          value={task.priority}
          onChange={(priority: Priority) =>
            update.mutate({ task, patch: { priority } })
          }
        />
      </div>

      <div className="task-row__action">
        <label className="ml-field__label" htmlFor={`${id}-due`}>
          Planned
        </label>
        <DueDateInput
          id={`${id}-due`}
          value={task.dueDate}
          onChange={(dueDate) =>
            update.mutate({
              task,
              // Clearing the date clears the time with it (spec 8.2 invariant 3).
              patch: dueDate === null ? { dueDate: null, dueTime: null } : { dueDate },
            })
          }
        />
      </div>

      <div className="task-row__action">
        <label className="ml-field__label" htmlFor={`${id}-defer`}>
          Defer until
        </label>
        <DueDateInput
          id={`${id}-defer`}
          value={task.deferUntil}
          onChange={(deferUntil) => update.mutate({ task, patch: { deferUntil } })}
        />
      </div>

      <div className="task-row__action">
        <label className="ml-field__label" htmlFor={`${id}-deadline`}>
          Deadline
        </label>
        <DueDateInput
          id={`${id}-deadline`}
          value={task.deadline}
          onChange={(deadline) =>
            update.mutate({
              task,
              patch:
                deadline === null
                  ? { deadline: null, deadlineTime: null }
                  : { deadline },
            })
          }
        />
      </div>

      <div className="task-row__action task-row__action--end">
        <Button
          aria-pressed={inMyDay}
          aria-label={
            inMyDay ? `Remove ${task.title} from My Day` : `Add ${task.title} to My Day`
          }
          loading={addToDay.isPending || removeFromDay.isPending}
          disabled={task.isCompleted}
          onClick={() => (inMyDay ? removeFromDay.mutate(task) : addToDay.mutate(task))}
        >
          {inMyDay ? "Remove from My Day" : "Add to My Day"}
        </Button>
        <Button variant="danger" aria-label={`Delete ${task.title}`} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/** A Trash row: restore is the only thing that can be done to a deleted task. */
export function TrashRow({ task }: { readonly task: TaskDto }) {
  const restore = useRestoreTask();

  return (
    <li className="task-row">
      <div className="task-row__main">
        <div className="task-row__body">
          <span className="task-row__title">{task.title}</span>
          <span className="task-row__meta">
            <span className="task-row__key">{task.key}</span>
            <PriorityBadge priority={task.priority} />
            {task.deletedAt ? (
              <time dateTime={task.deletedAt}>
                Deleted {new Date(task.deletedAt).toLocaleDateString()}
              </time>
            ) : null}
          </span>
          <TagChips tags={task.tags} />
        </div>
        <Button
          loading={restore.isPending}
          aria-label={`Restore ${task.title}`}
          onClick={() => restore.mutate(task)}
        >
          Restore
        </Button>
      </div>
    </li>
  );
}
