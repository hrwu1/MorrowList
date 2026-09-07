"use client";

import type { TaskDto } from "@morrowlist/contracts";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Markdown } from "@/features/tasks/components/markdown";
import {
  blockedWarning,
  openSubtasksWarning,
} from "@/features/tasks/components/task-row";
import { useCompleteTask, useTask } from "@/features/tasks/hooks/use-tasks";
import { useUndo } from "@/features/tasks/hooks/use-undo";
import { hasOpenSubtasks } from "@/features/tasks/lib/task-projections";

/** A quiet presentation of an existing task; focus never creates another task state. */
export function TodayFocus({
  tasks,
  today,
  hrefFor,
  onChoose,
}: {
  readonly tasks: readonly TaskDto[];
  readonly today: string;
  readonly hrefFor: (key: string) => string;
  readonly onChoose: () => void;
}) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [focused, setFocused] = useState<TaskDto | null>(null);
  const [finished, setFinished] = useState<TaskDto | null>(null);
  const focusSession = useRef(0);
  const focusButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const selectId = useId();
  const dialogTitle = useId();
  const complete = useCompleteTask();
  const undo = useUndo();
  const detail = useTask(focused?.id ?? null);
  const selected = tasks.find((task) => task.id === chosenId) ?? tasks[0];
  const currentTask = detail.data ?? focused;

  useEffect(() => {
    if (!focused) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [focused]);

  useEffect(() => {
    if (finished) successHeading.current?.focus();
  }, [finished]);

  function closeFocus() {
    focusSession.current += 1;
    dialog.current?.close();
    setFocused(null);
    setFinished(null);
    complete.reset();
    window.requestAnimationFrame(() => {
      (focusButton.current ?? chooseButton.current)?.focus();
    });
  }

  function finishTask() {
    if (!currentTask || complete.isPending || detail.isPending || detail.isError)
      return;
    if (currentTask.isBlocked && !window.confirm(blockedWarning(currentTask))) return;
    if (
      hasOpenSubtasks(currentTask) &&
      !window.confirm(openSubtasksWarning(currentTask))
    ) {
      return;
    }
    const session = focusSession.current;
    complete.mutate(currentTask, {
      onSuccess: (task) => {
        if (focusSession.current === session) setFinished(task);
      },
    });
  }

  return (
    <>
      <section className="studio-focus-card" aria-label="One thing at a time">
        <div className="studio-focus-card__topline">
          <span className="studio-focus-card__eyebrow">
            <span className="studio-focus-dot" aria-hidden="true" />
            One thing at a time
          </span>
          <span className="studio-focus-card__number" aria-hidden="true">
            01
          </span>
        </div>
        {selected ? (
          <>
            <div className="studio-focus-card__task">
              <p className="studio-focus-card__meta">
                <span>{selected.key}</span>
                <span>{focusDueLabel(selected, today)}</span>
                {selected.isBlocked ? <span>Blocked</span> : null}
              </p>
              <h3>{selected.title}</h3>
            </div>
            <div className="studio-focus-card__actions">
              <button
                className="studio-focus-start"
                type="button"
                ref={focusButton}
                onClick={() => {
                  focusSession.current += 1;
                  complete.reset();
                  setFinished(null);
                  setFocused(selected);
                }}
              >
                Start focusing <Arrow />
              </button>
              <Link className="studio-focus-details" href={hrefFor(selected.key)}>
                View task details
              </Link>
            </div>
            {tasks.length > 1 ? (
              <div className="studio-focus-picker">
                <label htmlFor={selectId}>Or focus on</label>
                <select
                  id={selectId}
                  value={selected.id}
                  onChange={(event) => setChosenId(event.target.value)}
                >
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </>
        ) : (
          <div className="studio-focus-card__empty">
            <h3>
              What deserves
              <br />
              your attention?
            </h3>
            <p>You do not need to do it all. Start with one thing.</p>
            <button
              className="studio-focus-start"
              type="button"
              ref={chooseButton}
              onClick={onChoose}
            >
              Find your first focus <Arrow />
            </button>
          </div>
        )}
        <div className="studio-focus-rings" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      {focused ? (
        <dialog
          ref={dialog}
          className="studio-focus-dialog"
          aria-labelledby={dialogTitle}
          onCancel={(event) => {
            event.preventDefault();
            closeFocus();
          }}
        >
          <div className="studio-focus-dialog__topline">
            <span className="studio-focus-dialog__eyebrow">Your quiet space</span>
            <button type="button" className="studio-focus-close" onClick={closeFocus}>
              Back to my day <span aria-hidden="true">×</span>
            </button>
          </div>
          {finished ? (
            <div className="studio-focus-success">
              <span className="studio-focus-success__mark" aria-hidden="true">
                ✓
              </span>
              <h2 id={dialogTitle} ref={successHeading} tabIndex={-1}>
                A little lighter.
              </h2>
              <p>
                <strong>{finished.title}</strong> is done.
              </p>
              <p>Take a breath before the next thing.</p>
              <button
                type="button"
                className="studio-focus-finish"
                onClick={closeFocus}
              >
                Return to my day <Arrow />
              </button>
              {undo.entry?.id === finished.id ? (
                <button
                  type="button"
                  className="studio-focus-undo"
                  onClick={() => {
                    undo.undo();
                    closeFocus();
                  }}
                >
                  Undo completion
                </button>
              ) : null}
            </div>
          ) : currentTask ? (
            <div className="studio-focus-dialog__body">
              <p className="studio-focus-dialog__meta">
                <span>{currentTask.key}</span>
                <span>{focusDueLabel(currentTask, today)}</span>
                {currentTask.priority !== "none" ? (
                  <span>{currentTask.priority} priority</span>
                ) : null}
              </p>
              <h2 id={dialogTitle}>{currentTask.title}</h2>
              <p className="studio-focus-dialog__reassurance">
                For now, this is enough.
              </p>
              {detail.isPending ? (
                <p role="status" className="studio-focus-dialog__load-state">
                  Loading task details…
                </p>
              ) : detail.isError ? (
                <div role="alert" className="studio-focus-dialog__warning">
                  <p>
                    Task details could not be refreshed. Try again before finishing.
                  </p>
                  <button
                    type="button"
                    className="studio-focus-close"
                    onClick={() => void detail.refetch()}
                  >
                    Retry task details
                  </button>
                </div>
              ) : null}
              {currentTask.isBlocked ? (
                <p className="studio-focus-dialog__warning">
                  This task is blocked. Check what it needs before finishing.
                </p>
              ) : null}
              {!detail.isPending && !detail.isError && currentTask.descriptionMd ? (
                <div className="studio-focus-description">
                  <Markdown source={currentTask.descriptionMd} />
                </div>
              ) : null}
              {currentTask.subtaskProgress && currentTask.subtaskProgress.total > 0 ? (
                <p className="studio-focus-dialog__subtasks">
                  {currentTask.subtaskProgress.completed} of{" "}
                  {currentTask.subtaskProgress.total} subtasks complete
                </p>
              ) : null}
              {complete.isError ? (
                <p role="alert" className="studio-focus-dialog__warning">
                  {complete.error instanceof Error
                    ? complete.error.message
                    : "This task could not be completed. Please try again."}
                </p>
              ) : null}
              <button
                type="button"
                className="studio-focus-finish"
                disabled={
                  complete.isPending ||
                  currentTask.isCompleted ||
                  detail.isPending ||
                  detail.isError
                }
                onClick={finishTask}
              >
                {complete.isPending
                  ? "Finishing…"
                  : currentTask.isCompleted
                    ? "Already completed"
                    : "Mark as complete"}
                <span aria-hidden="true">✓</span>
              </button>
            </div>
          ) : null}
        </dialog>
      ) : null}
    </>
  );
}

function focusDueLabel(task: TaskDto, today: string): string {
  if (task.dueDate && task.dueDate < today) return `Overdue · ${task.dueDate}`;
  if (task.dueDate === today)
    return task.dueTime ? `Due today · ${task.dueTime}` : "Due today";
  if (task.dueDate) return `Planned · ${task.dueDate}`;
  return "Chosen for today";
}

function Arrow() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  );
}
