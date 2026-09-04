"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { Alert, Button, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import {
  useClearTaskParent,
  useCompleteTask,
  useCreateTask,
  useReopenTask,
  useReorderTask,
  useTaskList,
} from "../hooks/use-tasks";

import { SubtaskProgressBadge } from "./task-fields";
import { blockedWarning } from "./task-row";

import { BlockedBadge } from "@/features/relations/components/blocked-badge";

/**
 * The subtasks of one task (spec 8.3). Each is an ordinary task listed by parent, so
 * completing, opening, or detaching one here is the same command any other view would
 * send. Adding one needs only a title: it joins the parent's project on the server.
 */
export function SubtaskList({ parent }: { readonly parent: TaskDto }) {
  const list = useTaskList({ parentTaskId: parent.id, sort: "rank", order: "asc" });
  const create = useCreateTask();
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const detach = useClearTaskParent();
  const reorder = useReorderTask();
  const [title, setTitle] = useState("");
  const id = useId();

  const subtasks = list.data?.data ?? [];
  const busy = complete.isPending || reopen.isPending || detach.isPending;

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    try {
      await create.mutateAsync({ title: trimmed, parentTaskId: parent.id });
      setTitle("");
    } catch {
      // Rendered below from the mutation state.
    }
  }

  /** Manual order only means something between tasks that share a status scope. */
  function siblingsOf(task: TaskDto): TaskDto[] {
    return subtasks.filter(
      (candidate) =>
        candidate.projectId === task.projectId && candidate.statusId === task.statusId,
    );
  }

  function move(task: TaskDto, direction: -1 | 1) {
    const siblings = siblingsOf(task);
    const index = siblings.findIndex((candidate) => candidate.id === task.id);
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const without = siblings.filter((candidate) => candidate.id !== task.id);
    reorder.mutate({
      task,
      beforeTaskId: without[target - 1]?.id ?? null,
      afterTaskId: without[target]?.id ?? null,
    });
  }

  return (
    <section className="subtask-list" aria-labelledby={`${id}-heading`}>
      <div className="task-detail__section-header">
        <h3 className="task-detail__section-title" id={`${id}-heading`}>
          Subtasks
        </h3>
        <SubtaskProgressBadge progress={parent.subtaskProgress} />
      </div>

      {subtasks.length > 0 ? (
        <ul className="subtask-list__items" aria-label="Subtasks">
          {subtasks.map((task) => {
            const siblings = siblingsOf(task);
            const position = siblings.findIndex(
              (candidate) => candidate.id === task.id,
            );
            return (
              <li
                key={task.id}
                className="subtask-list__item"
                data-done={task.isCompleted || undefined}
              >
                <button
                  type="button"
                  className="task-row__check"
                  disabled={busy}
                  aria-label={`${task.isCompleted ? "Reopen" : "Complete"} ${task.title}`}
                  aria-pressed={task.isCompleted}
                  onClick={() => {
                    if (task.isCompleted) return reopen.mutate(task);
                    if (task.isBlocked && !window.confirm(blockedWarning(task))) return;
                    complete.mutate(task);
                  }}
                >
                  <span aria-hidden="true">{task.isCompleted ? "✓" : ""}</span>
                </button>
                <Link
                  className="subtask-list__title"
                  href={`/tasks/${encodeURIComponent(task.key)}`}
                >
                  {task.title}
                </Link>
                <span className="task-row__key">{task.key}</span>
                <BlockedBadge task={task} />
                <SubtaskProgressBadge progress={task.subtaskProgress} />
                <span className="subtask-list__actions">
                  <Button
                    variant="ghost"
                    aria-label={`Move ${task.title} up`}
                    disabled={position <= 0 || reorder.isPending}
                    onClick={() => move(task, -1)}
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Move ${task.title} down`}
                    disabled={position >= siblings.length - 1 || reorder.isPending}
                    onClick={() => move(task, 1)}
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Detach ${task.title}`}
                    disabled={busy}
                    onClick={() => detach.mutate(task)}
                  >
                    Detach
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : list.isPending ? null : (
        <p className="task-detail__hint">
          Break this task down: a subtask needs only a title.
        </p>
      )}

      <form className="subtask-list__form" aria-label="Add a subtask" onSubmit={add}>
        <label className="ml-visually-hidden" htmlFor={`${id}-title`}>
          Subtask name
        </label>
        <TextInput
          id={`${id}-title`}
          value={title}
          maxLength={500}
          autoComplete="off"
          placeholder="Add a subtask and press Enter"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="submit"
          loading={create.isPending}
          disabled={title.trim().length === 0}
        >
          Add subtask
        </Button>
      </form>

      {create.isError || reorder.isError || detach.isError || list.isError ? (
        <Alert tone="error">
          {[create.error, reorder.error, detach.error, list.error].find(
            (error) => error instanceof Error,
          )?.message ?? "The subtasks could not be updated."}
        </Alert>
      ) : null}
    </section>
  );
}
