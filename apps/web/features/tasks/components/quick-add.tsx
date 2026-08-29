"use client";

import type { CreateTaskRequest, Priority } from "@morrowlist/contracts";
import { Alert, Button, TextInput, VisuallyHidden } from "@morrowlist/ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useCreateTask } from "../hooks/use-tasks";

import { DueDateInput, PrioritySelect } from "./task-fields";

/**
 * Global quick add (TASK-010, spec 10.1).
 *
 * Capture must never be blocked by a decision: a title alone is enough, and the task
 * lands in the Inbox. Priority and a due date are available for the times the decision is
 * already made, but they stay collapsed so the common case is still one field and one
 * keystroke. The field keeps focus after submitting so several thoughts can be captured
 * in a row.
 */
export function QuickAdd() {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const detailsId = useId();
  const createTask = useCreateTask();

  // "n" is the conventional new-task shortcut; it must not fire while typing elsewhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (event.key === "n" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    const request: CreateTaskRequest = {
      title: trimmed,
      ...(priority === "none" ? {} : { priority }),
      ...(dueDate === null ? {} : { dueDate }),
    };

    try {
      const task = await createTask.mutateAsync(request);
      setTitle("");
      // The optional fields reset too: they belong to the thought just captured, and
      // carrying them into the next one silently mislabels it.
      setPriority("none");
      setDueDate(null);
      setAnnouncement(`Added ${task.key} to your Inbox.`);
      inputRef.current?.focus();
    } catch {
      // The error is rendered below from the mutation state.
    }
  }

  return (
    <form className="quick-add" aria-label="Quick add" onSubmit={onSubmit}>
      <div className="quick-add__row">
        <label htmlFor="quick-add-title">
          <VisuallyHidden>Task title</VisuallyHidden>
        </label>
        <TextInput
          id="quick-add-title"
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task and press Enter"
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
            <label className="ml-field__label" htmlFor="quick-add-priority">
              Priority
            </label>
            <PrioritySelect
              id="quick-add-priority"
              value={priority}
              onChange={setPriority}
            />
          </div>
          <div className="quick-add__field">
            <label className="ml-field__label" htmlFor="quick-add-due">
              Due date
            </label>
            <DueDateInput id="quick-add-due" value={dueDate} onChange={setDueDate} />
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

      {/* Confirming capture without stealing focus (spec 14). */}
      <output className="ml-visually-hidden" aria-live="polite">
        {announcement}
      </output>
    </form>
  );
}
