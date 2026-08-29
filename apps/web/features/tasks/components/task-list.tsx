"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";

import {
  useCompleteTask,
  useDeleteTask,
  useInboxTasks,
  useReopenTask,
} from "../hooks/use-tasks";

/**
 * The Inbox list (VIEW-001, spec 9.1).
 *
 * Tasks appear in manual rank order — never re-sorted underneath the user — and the
 * inline actions are real buttons so every one of them is reachable by keyboard.
 */
export function InboxList() {
  const { data, isPending, isError, error, refetch } = useInboxTasks();
  const completeTask = useCompleteTask();
  const deleteTask = useDeleteTask();

  if (isPending) {
    return (
      <div className="task-list__status">
        <Spinner label="Loading your Inbox" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert tone="error" title="Your Inbox could not be loaded">
        <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
        <Button onClick={() => void refetch()}>Try again</Button>
      </Alert>
    );
  }

  const tasks = data.data;
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="Your Inbox is clear"
        description="Anything you capture lands here first. Sort it into a project when you are ready — not before."
      />
    );
  }

  return (
    <ul className="task-list" aria-label="Inbox tasks">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onComplete={() => completeTask.mutate(task)}
          onDelete={() => deleteTask.mutate(task)}
          busy={
            (completeTask.isPending && completeTask.variables?.id === task.id) ||
            (deleteTask.isPending && deleteTask.variables?.id === task.id)
          }
        />
      ))}
    </ul>
  );
}

interface TaskRowProps {
  readonly task: TaskDto;
  readonly onComplete: () => void;
  readonly onDelete: () => void;
  readonly busy: boolean;
}

function TaskRow({ task, onComplete, onDelete, busy }: TaskRowProps) {
  return (
    <li className="task-row" data-busy={busy || undefined}>
      <button
        type="button"
        className="task-row__check"
        onClick={onComplete}
        disabled={busy}
        // The label names the task, so the control is unambiguous out of context.
        aria-label={`Complete ${task.title}`}
      >
        <span aria-hidden="true" />
      </button>

      <div className="task-row__body">
        <span className="task-row__title">{task.title}</span>
        <span className="task-row__meta">
          <span className="task-row__key">{task.key}</span>
          {task.dueDate ? (
            <time dateTime={task.dueDate}>Due {task.dueDate}</time>
          ) : null}
          {task.priority !== "none" ? (
            <span
              className="task-row__priority"
              data-priority={task.priority}
            >
              {/* Priority is never conveyed by colour alone (spec 14). */}
              {task.priority}
            </span>
          ) : null}
        </span>
      </div>

      <Button variant="ghost" onClick={onDelete} disabled={busy}>
        Delete
      </Button>
    </li>
  );
}

/** Completed tasks, with the reopen path (spec 9.6). */
export function CompletedList({ tasks }: { readonly tasks: readonly TaskDto[] }) {
  const reopenTask = useReopenTask();

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="Nothing completed yet"
        description="Completed tasks stay here with their history intact."
      />
    );
  }

  return (
    <ul className="task-list" aria-label="Completed tasks">
      {tasks.map((task) => (
        <li key={task.id} className="task-row task-row--done">
          <div className="task-row__body">
            <span className="task-row__title">{task.title}</span>
            <span className="task-row__meta">
              <span className="task-row__key">{task.key}</span>
              {task.completedAt ? (
                <time dateTime={task.completedAt}>
                  Completed {new Date(task.completedAt).toLocaleDateString()}
                </time>
              ) : null}
            </span>
          </div>
          <Button variant="ghost" onClick={() => reopenTask.mutate(task)}>
            Reopen
          </Button>
        </li>
      ))}
    </ul>
  );
}
