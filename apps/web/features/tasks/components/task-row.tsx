"use client";

import type { Priority, TaskDto } from "@morrowlist/contracts";
import { Button } from "@morrowlist/ui";
import Link from "next/link";
import { useId, useState } from "react";

import {
  useCompleteTask,
  useDeleteTask,
  useReopenTask,
  useRestoreTask,
  useUpdateTask,
} from "../hooks/use-tasks";
import { writeTaskDrag } from "../lib/task-drag";

import { DueBadge, DueDateInput, PriorityBadge, PrioritySelect } from "./task-fields";

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
}

export function TaskRow({ task, detailHref, selected }: TaskRowProps) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const remove = useDeleteTask();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const busy = complete.isPending || reopen.isPending || remove.isPending;

  return (
    <li
      className="task-row"
      data-busy={busy || undefined}
      data-done={task.isCompleted || undefined}
      aria-current={selected ? "true" : undefined}
      // A row can be dragged onto a project in the sidebar to send it there.
      draggable
      onDragStart={(event) => {
        writeTaskDrag(event.dataTransfer, task);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setDragImage(event.currentTarget, 16, 16);
      }}
    >
      <div className="task-row__main">
        <button
          type="button"
          className="task-row__check"
          onClick={() =>
            task.isCompleted ? reopen.mutate(task) : complete.mutate(task)
          }
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
            />
            {task.completedAt ? (
              <time dateTime={task.completedAt}>
                Completed {new Date(task.completedAt).toLocaleDateString()}
              </time>
            ) : null}
          </span>
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
          Due date
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

      <div className="task-row__action task-row__action--end">
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
