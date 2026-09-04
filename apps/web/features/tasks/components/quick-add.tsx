"use client";

import type { CreateTaskRequest, Priority } from "@morrowlist/contracts";
import { Alert, Button, TextInput } from "@morrowlist/ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useCreateTask } from "../hooks/use-tasks";

import { DueDateInput, PrioritySelect } from "./task-fields";

import { useCacheScope } from "@/features/offline/hooks/use-cache-scope";
import { useOnline } from "@/features/offline/hooks/use-online";
import {
  clearDraft,
  draftKey,
  readDraft,
  writeDraft,
} from "@/features/offline/lib/drafts";

/**
 * Global quick add (TASK-010, spec 10.1).
 *
 * Capture must never be blocked by a decision: a title alone is enough, and the task
 * lands in the Inbox. Priority and a due date are available for the times the decision is
 * already made, but they stay collapsed so the common case is still one field and one
 * keystroke. The field keeps focus after submitting so several thoughts can be captured
 * in a row.
 *
 * A capture that cannot be sent — offline, or a failed request — is kept on this device
 * under the workspace and destination it was meant for (spec 25.1), restored into the
 * field on the next visit, and offered as "Send now" once the connection is back. It is
 * never sent on its own (ADR-008).
 */
export interface QuickAddProps {
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
  projectId,
  statusId,
  destinationLabel,
  autoFocus = false,
}: QuickAddProps = {}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
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
    ? draftKey(scope.workspaceId, statusId ?? projectId ?? "inbox")
    : null;

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

  async function submit() {
    const trimmed = title.trim();
    if (trimmed.length === 0 || createTask.isPending) return;

    const request: CreateTaskRequest = {
      title: trimmed,
      ...(projectId ? { projectId } : {}),
      ...(statusId ? { statusId } : {}),
      ...(priority === "none" ? {} : { priority }),
      ...(dueDate === null ? {} : { dueDate }),
    };

    try {
      const task = await createTask.mutateAsync(request);
      if (storageKey) clearDraft(storageKey);
      setUnsent(false);
      setTitle("");
      // The optional fields reset too: they belong to the thought just captured, and
      // carrying them into the next one silently mislabels it.
      setPriority("none");
      setDueDate(null);
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
