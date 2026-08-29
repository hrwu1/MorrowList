"use client";

import { Alert, Button, TextInput, VisuallyHidden } from "@morrowlist/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useCreateTask } from "../hooks/use-tasks";

/**
 * Global quick add (TASK-010, spec 10.1).
 *
 * Capture must never be blocked by a decision: a title alone is enough, and the task
 * lands in the Inbox. The field keeps focus after submitting so several thoughts can be
 * captured in a row.
 */
export function QuickAdd() {
  const [title, setTitle] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask();

  // "n" is the conventional new-task shortcut; it must not fire while typing elsewhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
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

    try {
      const task = await createTask.mutateAsync({ title: trimmed });
      setTitle("");
      setAnnouncement(`Added ${task.key} to your Inbox.`);
      inputRef.current?.focus();
    } catch {
      // The error is rendered below from the mutation state.
    }
  }

  return (
    <form className="quick-add" onSubmit={onSubmit}>
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
          type="submit"
          variant="primary"
          loading={createTask.isPending}
          disabled={title.trim().length === 0}
        >
          Add
        </Button>
      </div>

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
