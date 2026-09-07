"use client";

import type { CreateTaskRequest, Priority, TaskDto } from "@morrowlist/contracts";
import { removeSpan, type CaptureSpan } from "@morrowlist/domain";
import { Alert, Button, TextInput } from "@morrowlist/ui";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { useCaptureNames, useParsingEnabled } from "../hooks/use-capture";
import { useCreateTask } from "../hooks/use-tasks";
import { capturePlan, capturePreview, parseQuickAdd } from "../lib/capture";

import { DueDateInput, PrioritySelect } from "./task-fields";

import { useCacheScope } from "@/features/offline/hooks/use-cache-scope";
import { useOnline } from "@/features/offline/hooks/use-online";
import {
  clearDraft,
  draftKey,
  readDraft,
  writeDraft,
} from "@/features/offline/lib/drafts";
import { useCreateProject } from "@/features/projects/hooks/use-projects";
import { useAddTaskTag, useCreateTag, useTags } from "@/features/tags/hooks/use-tags";

/**
 * Global quick add (TASK-010, spec 10.1).
 *
 * Capture must never be blocked by a decision: a title alone is enough, and the task
 * lands in the Inbox. Priority and a due date are available for the times the decision is
 * already made, but they stay collapsed so the common case is still one field and one
 * keystroke. The field keeps focus after submitting so several thoughts can be captured
 * in a row.
 *
 * What is typed is also read for dates, priority, a project, tags and a repeat (GAP-15,
 * ADR pending-natural-language-capture). The spec deferred that because unexpected
 * parsing slows capture down, so nothing here is silent: every match becomes a chip
 * saying what it resolved to, each chip removes its own text, a backslash escapes a
 * token, and the whole thing can be switched off in settings. The request is built from
 * that one parse; the server is sent ordinary fields and never parses anything.
 *
 * A capture that cannot be sent — offline, or a failed request — is kept on this device
 * under the workspace and destination it was meant for (spec 25.1), restored into the
 * field on the next visit, and offered as "Send now" once the connection is back. It is
 * never sent on its own (ADR-008).
 */
export interface QuickAddProps {
  readonly initialDueDate?: string | undefined;
  readonly projectId?: string | undefined;
  readonly statusId?: string | undefined;
  readonly destinationLabel?: string | undefined;
  readonly autoFocus?: boolean | undefined;
}

interface QuickAddDraft {
  readonly title: string;
  readonly priority: Priority;
  readonly dueDate: string | null;
}

export function QuickAdd({
  initialDueDate,
  projectId,
  statusId,
  destinationLabel,
  autoFocus = false,
}: QuickAddProps = {}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [dueDate, setDueDate] = useState<string | null>(initialDueDate ?? null);
  const [showDetails, setShowDetails] = useState(Boolean(initialDueDate));
  const [unsent, setUnsent] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const detailsId = `${id}-details`;
  const titleId = `${id}-title`;
  const priorityId = `${id}-priority`;
  const dueId = `${id}-due`;
  const createTask = useCreateTask();
  const online = useOnline();
  const scope = useCacheScope();
  const storageKey = scope
    ? draftKey(
        scope.workspaceId,
        initialDueDate
          ? `calendar:${initialDueDate}`
          : (statusId ?? projectId ?? "inbox"),
      )
    : null;

  const parsingEnabled = useParsingEnabled();
  const names = useCaptureNames();
  const tagList = useTags();
  const addTaskTag = useAddTaskTag();
  const createProject = useCreateProject();
  const createTag = useCreateTag();

  const parsed = useMemo(
    () =>
      parsingEnabled && title.trim().length > 0
        ? parseQuickAdd(title, names.today, names.projects, names.tags)
        : null,
    [parsingEnabled, title, names],
  );
  const spans = parsed?.spans ?? [];

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Restore an unsent capture once the workspace is known, without overwriting typing.
  useEffect(() => {
    if (!storageKey) return;
    const draft = readDraft<QuickAddDraft>(storageKey);
    if (!draft?.title) return;
    setTitle((current) => current || draft.title);
    setPriority(draft.priority);
    setDueDate(draft.dueDate);
    if (draft.priority !== "none" || draft.dueDate !== null) setShowDetails(true);
    setUnsent(true);
  }, [storageKey]);

  function keepDraft(next: QuickAddDraft) {
    if (storageKey) writeDraft(storageKey, next);
    setUnsent(true);
  }

  /** Put a rewritten line back in the field, keeping focus where the typing was. */
  function retype(next: string) {
    setTitle(next);
    if (unsent) keepDraft({ title: next, priority, dueDate });
    inputRef.current?.focus();
  }

  /** Make the project or tag the text named; the next parse then resolves it. */
  async function create(span: CaptureSpan) {
    try {
      if (span.kind === "project")
        await createProject.mutateAsync({ name: span.value });
      else await createTag.mutateAsync({ name: span.value });
      inputRef.current?.focus();
    } catch {
      // The name may already exist under another casing, or the request failed. The text
      // is still in the field either way, so there is nothing to recover.
    }
  }

  async function submit() {
    const trimmed = title.trim();
    if (trimmed.length === 0 || createTask.isPending) return;

    const plan = parsed
      ? capturePlan(parsed, names.projects, names.tags, { projectId, statusId })
      : {
          request: {
            title: trimmed,
            ...(projectId ? { projectId } : {}),
            ...(statusId ? { statusId } : {}),
          } satisfies CreateTaskRequest,
          tagIds: [] as readonly string[],
        };

    const request: CreateTaskRequest = {
      ...plan.request,
      // The collapsed controls are a deliberate choice, so they beat the text.
      ...(priority === "none" ? {} : { priority }),
      ...(dueDate === null ? {} : { dueDate }),
    };

    try {
      let task: TaskDto = await createTask.mutateAsync(request);
      for (const tagId of plan.tagIds) {
        const tag = tagList.data?.data.find((candidate) => candidate.id === tagId);
        if (tag) task = await addTaskTag.mutateAsync({ task, tag });
      }
      if (storageKey) clearDraft(storageKey);
      setUnsent(false);
      setTitle("");
      // The optional fields reset too: they belong to the thought just captured, and
      // carrying them into the next one silently mislabels it.
      setPriority("none");
      setDueDate(initialDueDate ?? null);
      setAnnouncement(`Added ${task.key} to ${destinationLabel ?? "your Inbox"}.`);
      inputRef.current?.focus();
    } catch {
      // The error is rendered below from the mutation state; the text stays put.
      keepDraft({ title: trimmed, priority, dueDate });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="quick-add" aria-label="Quick add" onSubmit={onSubmit}>
      <div className="quick-add__row">
        <label className="ml-visually-hidden" htmlFor={titleId}>
          Task title
        </label>
        <TextInput
          id={titleId}
          ref={inputRef}
          autoFocus={autoFocus}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (unsent) keepDraft({ title: event.target.value, priority, dueDate });
          }}
          placeholder={
            destinationLabel
              ? `Add to ${destinationLabel} and press Enter`
              : "Add a task and press Enter"
          }
          maxLength={500}
          autoComplete="off"
        />
        <Button
          aria-expanded={showDetails}
          aria-controls={detailsId}
          onClick={() => setShowDetails((current) => !current)}
        >
          Details
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={createTask.isPending}
          disabled={title.trim().length === 0}
        >
          Add
        </Button>
      </div>

      {parsed && spans.length > 0 ? (
        <>
          <ul className="quick-add__chips" aria-label="Read from what you typed">
            {spans.map((span) => (
              <li key={`${span.kind}-${span.start}`}>
                {span.known ? (
                  <span className="quick-add__chip" data-kind={span.kind}>
                    {span.label}
                    <button
                      type="button"
                      className="quick-add__chip-remove"
                      aria-label={`Remove ${span.label}`}
                      onKeyDown={(event: KeyboardEvent) => {
                        if (event.key !== "Backspace" && event.key !== "Delete") return;
                        event.preventDefault();
                        retype(removeSpan(title, span));
                      }}
                      onClick={() => retype(removeSpan(title, span))}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                ) : (
                  <span className="quick-add__chip" data-unknown="true">
                    {span.label}
                    <button
                      type="button"
                      className="quick-add__chip-create"
                      disabled={createProject.isPending || createTag.isPending}
                      onClick={() => void create(span)}
                    >
                      Create
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="quick-add__preview" role="status">
            {capturePreview(parsed)}
          </p>
        </>
      ) : null}

      {showDetails ? (
        <div className="quick-add__details" id={detailsId}>
          <div className="quick-add__field">
            <label className="ml-field__label" htmlFor={priorityId}>
              Priority
            </label>
            <PrioritySelect id={priorityId} value={priority} onChange={setPriority} />
          </div>
          <div className="quick-add__field">
            <label className="ml-field__label" htmlFor={dueId}>
              Planned
            </label>
            <DueDateInput id={dueId} value={dueDate} onChange={setDueDate} />
          </div>
        </div>
      ) : null}

      {createTask.isError ? (
        <Alert tone="error">
          {createTask.error instanceof Error
            ? createTask.error.message
            : "The task could not be created."}
        </Alert>
      ) : null}

      {unsent && title.trim().length > 0 ? (
        <p className="quick-add__draft" role="status">
          <span>
            Saved on this device.{" "}
            {online
              ? "Send it whenever you are ready."
              : "It will be ready to send when you're back online."}
          </span>
          {online ? (
            <Button loading={createTask.isPending} onClick={() => void submit()}>
              Send now
            </Button>
          ) : null}
        </p>
      ) : null}

      {/* Confirming capture without stealing focus (spec 14). */}
      <output className="ml-visually-hidden" aria-live="polite">
        {announcement}
      </output>
    </form>
  );
}
