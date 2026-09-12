"use client";

import { ApiClientError } from "@morrowlist/api-client";
import type {
  Priority,
  RecurrenceRuleDto,
  TaskDto,
  UpdateTaskRequest,
} from "@morrowlist/contracts";
import {
  Alert,
  Button,
  Field,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from "@morrowlist/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useAddToDay,
  useClearTaskParent,
  useCompleteTask,
  useDeleteTask,
  useMoveTaskToProject,
  useRemoveFromDay,
  useReopenTask,
  useRestoreTask,
  useSkipOccurrence,
  useTask,
  useTaskList,
  useUpdateTask,
} from "../hooks/use-tasks";
import { describeRecurrence } from "../lib/recurrence";
import { DATE_WARNING_LABELS } from "../lib/task-dates";
import { allSubtasksDone, hasOpenSubtasks } from "../lib/task-projections";

import { Markdown } from "./markdown";
import { RecurrenceEditor } from "./recurrence-editor";
import { SubtaskList } from "./subtask-list";
import { TaskFeedbackOutlet } from "./task-feedback";
import {
  DueBadge,
  DueDateInput,
  DueTimeInput,
  PrioritySelect,
  ReminderSelect,
} from "./task-fields";

import { ActivityList } from "@/features/activity/components/activity-list";
import { TaskFieldValues } from "@/features/fields/components/task-field-values";
import { useProjects } from "@/features/projects/hooks/use-projects";
import { BlockedFlag } from "@/features/relations/components/blocked-flag";
import { RelationList } from "@/features/relations/components/relation-list";
import { blockedSummary } from "@/features/relations/lib/relations";
import { TagPicker } from "@/features/tags/components/tag-picker";
import { localToday } from "@/features/today/lib/today-view";

/**
 * Task detail (TASK-011, spec 10.2).
 *
 * The same component is the side panel on a list page and the body of `/tasks/{key}`, so
 * a task looks and behaves identically wherever it is opened.
 */

const AUTOSAVE_DELAY_MS = 700;

export interface TaskDetailProps {
  readonly idOrKey: string;
  readonly variant?: "page" | "panel" | undefined;
  readonly onClose?: (() => void) | undefined;
}

export function TaskDetail({ idOrKey, variant = "page", onClose }: TaskDetailProps) {
  const { data, isPending, isError, error, refetch } = useTask(idOrKey);

  if (isPending) {
    return (
      <div className="task-list__status">
        <Spinner label="Loading the task" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert tone="error" title="This task could not be loaded">
        <p>
          {error instanceof ApiClientError && error.code === "TASK_NOT_FOUND"
            ? "It may have been permanently removed, or the link may be wrong."
            : error instanceof Error
              ? error.message
              : "Something went wrong."}
        </p>
        <Button onClick={() => void refetch()}>Try again</Button>
      </Alert>
    );
  }

  return (
    <TaskDetailForm
      // Remounting on identity change discards a draft that belongs to another task.
      key={data.id}
      task={data}
      variant={variant}
      reload={async () => (await refetch()).data}
      {...(onClose ? { onClose } : {})}
    />
  );
}

interface Draft {
  title: string;
  descriptionMd: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: RecurrenceRuleDto | null;
  deferUntil: string | null;
  deadline: string | null;
  deadlineTime: string | null;
  reminderOffsetMinutes: number | null;
}

function toDraft(task: TaskDto): Draft {
  return {
    title: task.title,
    descriptionMd: task.descriptionMd ?? "",
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    recurrence: task.recurrence,
    deferUntil: task.deferUntil,
    deadline: task.deadline,
    deadlineTime: task.deadlineTime,
    reminderOffsetMinutes: task.reminderOffsetMinutes,
  };
}

type SaveState = "idle" | "saving" | "saved" | "failed";

interface TaskDetailFormProps {
  readonly task: TaskDto;
  readonly variant: "page" | "panel";
  readonly reload: () => Promise<TaskDto | undefined>;
  readonly onClose?: (() => void) | undefined;
}

function TaskDetailForm({ task, variant, reload, onClose }: TaskDetailFormProps) {
  const update = useUpdateTask();
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const remove = useDeleteTask();
  const restore = useRestoreTask();
  const move = useMoveTaskToProject();
  const addToDay = useAddToDay();
  const removeFromDay = useRemoveFromDay();
  const projects = useProjects();
  const inMyDay = task.dayPlans.length > 0;
  const detach = useClearTaskParent();
  const skip = useSkipOccurrence();
  const parent = useTask(task.parentTaskId);
  const series = useTaskList(
    { seriesId: task.seriesId ?? "", sort: "dueDate", order: "asc", limit: 50 },
    { enabled: task.seriesId !== null },
  );

  const [draft, setDraft] = useState(() => toDraft(task));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  // History is fetched only once its disclosure is open: on the task's own page that is
  // immediately, in the side panel on demand.
  const [showActivity, setShowActivity] = useState(variant === "page");
  const [confirmingComplete, setConfirmingComplete] = useState<
    "subtasks" | "blocked" | null
  >(null);

  // Refs, not state: the debounce callback must read the newest values without being
  // rescheduled every keystroke.
  const taskRef = useRef(task);
  const pending = useRef<UpdateTaskRequest>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutate = useRef(update.mutateAsync);
  /**
   * The version the next save must claim. It comes from save responses rather than from
   * the rendered task, because two edits in quick succession are both dispatched before
   * React has re-rendered with the first one's result — and the second would then send a
   * version the server has already moved past.
   */
  const version = useRef(task.version);
  /** Saves run one at a time; overlapping ones conflict with each other, not with a peer. */
  const queueTail = useRef<Promise<void>>(Promise.resolve());
  /** True while the draft holds anything the server has not accepted yet. */
  const dirty = useRef(false);

  taskRef.current = task;
  mutate.current = update.mutateAsync;
  if (task.version > version.current) version.current = task.version;

  const send = useCallback((patch: UpdateTaskRequest, against?: TaskDto) => {
    setSaveState("saving");
    queueTail.current = queueTail.current.then(async () => {
      try {
        const base = against ?? { ...taskRef.current, version: version.current };
        const updated = await mutate.current({ task: base, patch });
        version.current = updated.version;
        setSaveState("saved");
        setConflict(false);
        if (Object.keys(pending.current).length === 0 && !timer.current) {
          dirty.current = false;
        }
      } catch (failure) {
        // The draft is never thrown away on failure (spec 10.2): the patch goes back on
        // the queue so a retry re-sends exactly what the user typed.
        pending.current = { ...patch, ...pending.current };
        setSaveState("failed");
        setConflict(
          failure instanceof ApiClientError && failure.code === "TASK_VERSION_CONFLICT",
        );
      }
    });
    return queueTail.current;
  }, []);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    void send(patch);
  }, [send]);

  const queue = useCallback(
    (patch: UpdateTaskRequest, immediate: boolean) => {
      dirty.current = true;
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      if (immediate) flush();
      else timer.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  // Save whatever is outstanding when the panel or page goes away. `flush` is stable, so
  // this cleanup runs on unmount only — never on an incidental re-render.
  useEffect(() => () => flush(), [flush]);

  // Adopt the server's values when the task changes underneath — after a save of our own,
  // or a refetch — but never while the draft holds unsaved work.
  const seeded = useRef(task.version);
  useEffect(() => {
    if (seeded.current === task.version) return;
    seeded.current = task.version;
    if (dirty.current) return;
    setDraft(toDraft(task));
  }, [task]);

  const editable = task.deletedAt === null;
  const fieldId = (name: string) => `task-${task.id}-${name}`;

  function edit(patch: Partial<Draft>, request: UpdateTaskRequest, immediate: boolean) {
    setDraft((current) => ({ ...current, ...patch }));
    queue(request, immediate);
  }

  /**
   * A project change is a move, not a field patch, so it goes through the move command
   * (landing in the destination's default stage). It still runs on the save queue: a
   * move and a field save in flight together would otherwise conflict on the version.
   */
  function changeProject(projectId: string | null) {
    if (projectId === task.projectId) return;
    move.reset();
    const { mutateAsync } = move;
    queueTail.current = queueTail.current.then(async () => {
      try {
        const moved = await mutateAsync({
          task: { ...taskRef.current, version: version.current },
          projectId,
        });
        version.current = moved.task.version;
      } catch {
        // Reported through `move.isError`; the select falls back to the server's value.
      }
    });
  }

  /**
   * Completion runs on the save queue too: a field edit (a new repeat rule, say) followed
   * straight away by Mark complete must claim the version that edit produced, not the one
   * the panel rendered before it was saved.
   */
  function completeOnQueue() {
    const { mutateAsync } = complete;
    queueTail.current = queueTail.current.then(async () => {
      try {
        await mutateAsync({ ...taskRef.current, version: version.current });
      } catch {
        // Reported through `complete.isError`; the button falls back to the server's state.
      }
    });
  }

  const projectItems = projects.data?.data ?? [];
  const currentProjectKnown =
    task.projectId === null || projectItems.some((item) => item.id === task.projectId);

  return (
    <div className="task-detail">
      <header className="task-detail__header">
        <div className="task-detail__identity">
          <span className="task-row__key">{task.key}</span>
          <SaveStatus
            state={saveState}
            pendingChanges={update.isPending || move.isPending}
          />
        </div>
        {onClose ? (
          <Button onClick={onClose} variant="ghost" aria-label="Close task details">
            Close
          </Button>
        ) : null}
      </header>

      <TaskFeedbackOutlet />

      {task.deletedAt !== null ? (
        <Alert tone="info" title="This task is in the Trash">
          <p>Deleted {formatTimestamp(task.deletedAt)}. Restore it to edit it again.</p>
          <Button
            variant="primary"
            loading={restore.isPending}
            onClick={() => restore.mutate(task)}
          >
            Restore
          </Button>
        </Alert>
      ) : null}

      {conflict ? (
        <Alert tone="error" title="This task changed somewhere else">
          <p>
            Your edits were not saved, because someone — or another tab — changed the
            task after you opened it. Nothing has been overwritten.
          </p>
          <div className="button-row">
            <Button
              onClick={async () => {
                pending.current = {};
                dirty.current = false;
                const fresh = await reload();
                if (fresh) {
                  version.current = fresh.version;
                  setDraft(toDraft(fresh));
                }
                setConflict(false);
                setSaveState("idle");
              }}
            >
              Discard my changes
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const fresh = await reload();
                const patch = pending.current;
                pending.current = {};
                if (fresh) await send(patch, fresh);
              }}
            >
              Keep mine and overwrite
            </Button>
          </div>
        </Alert>
      ) : saveState === "failed" ? (
        <Alert tone="error" title="This task could not be saved">
          <p>Your changes are still here. Try again when you are ready.</p>
          <Button onClick={flush}>Retry</Button>
        </Alert>
      ) : null}

      <div className="task-detail__completion">
        <Button
          variant={task.isCompleted ? "secondary" : "primary"}
          disabled={!editable}
          loading={complete.isPending || reopen.isPending}
          onClick={() => {
            if (task.isCompleted) return reopen.mutate(task);
            // A blocked task completes only after an explicit warning (spec 8.4), and a
            // parent with open children needs confirmation (spec 8.3).
            if (task.isBlocked) return setConfirmingComplete("blocked");
            if (hasOpenSubtasks(task)) return setConfirmingComplete("subtasks");
            completeOnQueue();
          }}
        >
          {task.isCompleted ? "Reopen task" : "Mark complete"}
        </Button>
        <Button
          aria-pressed={inMyDay}
          disabled={!editable || task.isCompleted}
          loading={addToDay.isPending || removeFromDay.isPending}
          onClick={() => (inMyDay ? removeFromDay.mutate(task) : addToDay.mutate(task))}
        >
          {inMyDay ? "Remove from My Day" : "Add to My Day"}
        </Button>
        {task.completedAt ? (
          <span className="task-detail__hint">
            Completed {formatTimestamp(task.completedAt)}
          </span>
        ) : null}
      </div>

      {confirmingComplete === "blocked" && !task.isCompleted ? (
        <Alert tone="info" title="This task is blocked">
          <p>
            {blockedSummary(task)}. Completing it now leaves the blockers as they are.
          </p>
          <div className="button-row">
            <Button
              variant="primary"
              onClick={() => {
                setConfirmingComplete(null);
                completeOnQueue();
              }}
            >
              Complete anyway
            </Button>
            <Button onClick={() => setConfirmingComplete(null)}>Keep it open</Button>
          </div>
        </Alert>
      ) : null}

      {confirmingComplete === "subtasks" && !task.isCompleted ? (
        <Alert tone="info" title="Some subtasks are still open">
          <p>
            {(task.subtaskProgress?.total ?? 0) -
              (task.subtaskProgress?.completed ?? 0)}{" "}
            of {task.subtaskProgress?.total ?? 0} subtasks are not done. Completing this
            task leaves them as they are.
          </p>
          <div className="button-row">
            <Button
              variant="primary"
              onClick={() => {
                setConfirmingComplete(null);
                completeOnQueue();
              }}
            >
              Complete anyway
            </Button>
            <Button onClick={() => setConfirmingComplete(null)}>Keep it open</Button>
          </div>
        </Alert>
      ) : null}

      {!task.isCompleted && editable && allSubtasksDone(task) ? (
        <Alert tone="success" title="All subtasks are done">
          <p>Nothing here completes on its own; this task is still open.</p>
          <Button
            variant="primary"
            loading={complete.isPending}
            onClick={() =>
              task.isBlocked ? setConfirmingComplete("blocked") : completeOnQueue()
            }
          >
            Complete parent
          </Button>
        </Alert>
      ) : null}

      {task.parentTaskId ? (
        <p className="task-detail__hint task-detail__parent">
          Subtask of{" "}
          <Link
            href={`/tasks/${encodeURIComponent(parent.data?.key ?? task.parentTaskId)}`}
          >
            {parent.data
              ? `${parent.data.key} ${parent.data.title}`
              : "its parent task"}
          </Link>
          {editable ? (
            <Button
              variant="ghost"
              loading={detach.isPending}
              aria-label={`Detach ${task.title} from its parent`}
              onClick={() => detach.mutate(task)}
            >
              Detach
            </Button>
          ) : null}
        </p>
      ) : null}

      {move.isError ? (
        <Alert tone="error" title="This task could not be moved">
          <p>
            {move.error instanceof ApiClientError &&
            move.error.code === "TASK_VERSION_CONFLICT"
              ? "It changed somewhere else first. Reload it, then choose the project again."
              : move.error instanceof Error
                ? move.error.message
                : "It stayed where it was."}
          </p>
          <Button onClick={() => move.reset()}>Dismiss</Button>
        </Alert>
      ) : null}

      <Field label="Title" htmlFor={fieldId("title")}>
        <TextInput
          id={fieldId("title")}
          value={draft.title}
          maxLength={500}
          disabled={!editable}
          onChange={(event) =>
            edit({ title: event.target.value }, { title: event.target.value }, false)
          }
          onBlur={flush}
        />
      </Field>

      <details className="task-detail__disclosure">
        <summary className="task-detail__disclosure-summary">
          <span>Description</span>
          <span className="task-detail__hint">
            {draft.descriptionMd.trim().length > 0 ? "Notes added" : "Markdown notes"}
          </span>
        </summary>
        <div className="task-detail__disclosure-body stack-tight">
          <div className="task-detail__section-header">
            <label className="ml-field__label" htmlFor={fieldId("description")}>
              Markdown
            </label>
            <Button
              variant="ghost"
              aria-pressed={showPreview}
              onClick={() => setShowPreview((current) => !current)}
            >
              {showPreview ? "Hide preview" : "Show preview"}
            </Button>
          </div>
          <TextArea
            id={fieldId("description")}
            value={draft.descriptionMd}
            rows={6}
            maxLength={50_000}
            disabled={!editable}
            aria-describedby={fieldId("description-hint")}
            onChange={(event) =>
              edit(
                { descriptionMd: event.target.value },
                {
                  descriptionMd: event.target.value === "" ? null : event.target.value,
                },
                false,
              )
            }
            onBlur={flush}
          />
          <p className="ml-field__hint" id={fieldId("description-hint")}>
            Markdown is supported. HTML is shown as text, never rendered.
          </p>

          {showPreview ? (
            <div className="task-detail__preview">
              <h4 className="task-detail__preview-title">Preview</h4>
              {draft.descriptionMd.trim().length > 0 ? (
                <Markdown source={draft.descriptionMd} />
              ) : (
                <p className="task-detail__hint">Nothing to preview yet.</p>
              )}
            </div>
          ) : null}
        </div>
      </details>

      {editable ? <SubtaskList parent={task} /> : null}

      <Field
        label="Project"
        htmlFor={fieldId("project")}
        hint="A moved task starts in the project's default stage."
      >
        <Select
          id={fieldId("project")}
          value={task.projectId ?? ""}
          disabled={!editable || projects.isPending || move.isPending}
          onChange={(event) =>
            changeProject(event.target.value === "" ? null : event.target.value)
          }
        >
          <option value="">Inbox</option>
          {currentProjectKnown ? null : (
            <option value={task.projectId ?? ""}>Current project</option>
          )}
          {projectItems.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </Field>

      <details className="task-detail__disclosure">
        <summary className="task-detail__disclosure-summary">
          <span>Scheduling & priority</span>
          <span className="task-detail__hint">
            {[
              draft.priority !== "none" ? draft.priority : null,
              draft.dueDate ? `Planned ${draft.dueDate}` : null,
              draft.deadline ? `Deadline ${draft.deadline}` : null,
              draft.deferUntil ? `Deferred until ${draft.deferUntil}` : null,
              draft.recurrence ? describeRecurrence(draft.recurrence) : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Set dates, priority or repeat"}
          </span>
        </summary>
        <div className="task-detail__disclosure-body stack">
          <div className="task-detail__row">
            <Field label="Priority" htmlFor={fieldId("priority")}>
              <PrioritySelect
                id={fieldId("priority")}
                value={draft.priority}
                disabled={!editable}
                onChange={(priority) => edit({ priority }, { priority }, true)}
              />
            </Field>

            <Field
              label="Planned"
              htmlFor={fieldId("due-date")}
              hint="The day you plan to do it."
            >
              <DueDateInput
                id={fieldId("due-date")}
                value={draft.dueDate}
                disabled={!editable}
                onChange={(dueDate) =>
                  // Clearing the date clears the time with it (spec 8.2 invariant 3).
                  edit(
                    { dueDate, dueTime: dueDate === null ? null : draft.dueTime },
                    dueDate === null ? { dueDate: null, dueTime: null } : { dueDate },
                    true,
                  )
                }
              />
            </Field>

            <Field
              label="Planned time"
              htmlFor={fieldId("due-time")}
              hint={draft.dueDate ? undefined : "Set a planned day first."}
            >
              <DueTimeInput
                id={fieldId("due-time")}
                value={draft.dueTime}
                hasDueDate={draft.dueDate !== null}
                disabled={!editable}
                onChange={(dueTime) => edit({ dueTime }, { dueTime }, true)}
              />
            </Field>
          </div>

          <Field
            label="Repeat"
            htmlFor={fieldId("repeat")}
            hint={
              draft.recurrence
                ? `${describeRecurrence(draft.recurrence)}. Completing this task creates the next occurrence.`
                : undefined
            }
          >
            <RecurrenceEditor
              id={fieldId("repeat")}
              value={draft.recurrence}
              anchor={draft.dueDate ?? localToday()}
              disabled={!editable || task.isCompleted}
              onChange={(recurrence) => edit({ recurrence }, { recurrence }, true)}
            />
          </Field>
          <div className="task-detail__row">
            <Field
              label="Defer until"
              htmlFor={fieldId("defer-until")}
              hint="Hidden from Today, Upcoming, the Inbox and the board until then."
            >
              <DueDateInput
                id={fieldId("defer-until")}
                value={draft.deferUntil}
                disabled={!editable}
                onChange={(deferUntil) => edit({ deferUntil }, { deferUntil }, true)}
              />
            </Field>

            <Field
              label="Deadline"
              htmlFor={fieldId("deadline")}
              hint="The hard limit, separate from the planned day."
            >
              <DueDateInput
                id={fieldId("deadline")}
                value={draft.deadline}
                disabled={!editable}
                onChange={(deadline) =>
                  edit(
                    {
                      deadline,
                      deadlineTime: deadline === null ? null : draft.deadlineTime,
                    },
                    deadline === null
                      ? { deadline: null, deadlineTime: null }
                      : { deadline },
                    true,
                  )
                }
              />
            </Field>

            <Field
              label="Deadline time"
              htmlFor={fieldId("deadline-time")}
              hint={draft.deadline ? undefined : "Set a deadline first."}
            >
              <DueTimeInput
                id={fieldId("deadline-time")}
                value={draft.deadlineTime}
                hasDueDate={draft.deadline !== null}
                disabled={!editable}
                onChange={(deadlineTime) =>
                  edit({ deadlineTime }, { deadlineTime }, true)
                }
              />
            </Field>
          </div>

          {task.dateWarnings.length > 0 ? (
            <Alert tone="info" title="These dates are in an unusual order">
              <ul className="task-detail__warnings">
                {task.dateWarnings.map((warning) => (
                  <li key={warning}>{DATE_WARNING_LABELS[warning]}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {draft.dueTime ? (
            <Field
              label="Reminder"
              htmlFor={fieldId("reminder")}
              hint={
                task.reminderOffsetMinutes === null && draft.dueTime && !task.dueTime
                  ? "A new due time gets your default reminder once it is saved."
                  : undefined
              }
            >
              <ReminderSelect
                id={fieldId("reminder")}
                value={draft.reminderOffsetMinutes}
                disabled={!editable || task.dueTime === null}
                onChange={(reminderOffsetMinutes) =>
                  edit({ reminderOffsetMinutes }, { reminderOffsetMinutes }, true)
                }
              />
            </Field>
          ) : null}
        </div>
      </details>

      <TagPicker task={task} disabled={!editable} />

      <TaskFieldValues task={task} disabled={!editable} />

      <details className="task-detail__disclosure">
        <summary className="task-detail__disclosure-summary">
          <span>Relationships</span>
          <span className="task-detail__hint">
            {task.isBlocked ? blockedSummary(task) : "Blocking and related tasks"}
          </span>
        </summary>
        <div className="task-detail__disclosure-body stack">
          <BlockedFlag task={task} disabled={!editable} />

          <RelationList task={task} disabled={!editable} />
        </div>
      </details>

      {task.seriesId && series.data && series.data.data.length > 1 ? (
        <section className="task-detail__series" aria-labelledby={fieldId("series")}>
          <h3 className="task-detail__section-title" id={fieldId("series")}>
            Other occurrences
          </h3>
          <ul className="task-detail__series-list" aria-label="Other occurrences">
            {series.data.data
              .filter((occurrence) => occurrence.id !== task.id)
              .map((occurrence) => (
                <li key={occurrence.id} data-done={occurrence.isCompleted || undefined}>
                  <Link href={`/tasks/${encodeURIComponent(occurrence.key)}`}>
                    {occurrence.key}
                  </Link>{" "}
                  <DueBadge
                    dueDate={occurrence.dueDate}
                    dueTime={occurrence.dueTime}
                    isCompleted={occurrence.isCompleted}
                  />
                  {occurrence.isCompleted ? (
                    <span className="task-detail__hint">Completed</span>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <details
        className="task-detail__disclosure"
        open={variant === "page"}
        onToggle={(event) => setShowActivity(event.currentTarget.open)}
      >
        <summary className="task-detail__disclosure-summary">
          <span>Activity</span>
          <span className="task-detail__hint">Who changed what, and when</span>
        </summary>
        <div className="task-detail__disclosure-body">
          {showActivity ? (
            <ActivityList
              source={{ kind: "task", idOrKey: task.key }}
              label={`Activity for ${task.key}`}
            />
          ) : null}
        </div>
      </details>

      {variant === "panel" ? (
        <p className="task-detail__hint">
          <Link href={`/tasks/${encodeURIComponent(task.key)}`}>
            Open this task on its own page
          </Link>
        </p>
      ) : null}

      {editable ? (
        <details className="task-detail__disclosure task-detail__disclosure--danger">
          <summary className="task-detail__disclosure-summary">More actions</summary>
          <div className="task-detail__disclosure-body">
            {task.recurrence && !task.isCompleted ? (
              <div className="button-row">
                <Button loading={skip.isPending} onClick={() => skip.mutate(task)}>
                  Skip this occurrence
                </Button>
                <span className="task-detail__hint">
                  Moves this task on to its next date without completing it.
                </span>
              </div>
            ) : null}
            {skip.isError ? (
              <Alert tone="error" title="This occurrence could not be skipped">
                <p>
                  {skip.error instanceof Error
                    ? skip.error.message
                    : "It stayed where it was."}
                </p>
              </Alert>
            ) : null}
            <div className="button-row">
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(task)}
              >
                Move to Trash
              </Button>
              <span className="task-detail__hint">
                Deleted tasks stay in the Trash and can be restored.
              </span>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The save indicator is a live region, so the state is announced rather than only shown
 * (spec 10.2, 14).
 */
function SaveStatus({
  state,
  pendingChanges,
}: {
  readonly state: SaveState;
  readonly pendingChanges: boolean;
}) {
  const label =
    state === "saving" || pendingChanges
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "failed"
          ? "Not saved"
          : "";

  return (
    <output className="task-detail__save-state" data-state={state} aria-live="polite">
      {label}
    </output>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}
