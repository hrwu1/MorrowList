"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { Alert, Button, TextInput } from "@morrowlist/ui";
import { useId, useState, type FormEvent } from "react";

import { useClearTaskBlocked, useSetTaskBlocked } from "../hooks/use-relations";

/**
 * The explicit blocker flag (spec 8.4, GAP-06). Flagging asks for a reason and leaves
 * the task in its stage: the flag is the signal, the Blocked column stays a view.
 */
export function BlockedFlag({
  task,
  disabled = false,
}: {
  readonly task: TaskDto;
  readonly disabled?: boolean | undefined;
}) {
  const set = useSetTaskBlocked();
  const clear = useClearTaskBlocked();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const id = useId();
  const failure = set.error ?? clear.error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    try {
      await set.mutateAsync({ task, reason: trimmed });
      setEditing(false);
      setReason("");
    } catch {
      // Reported below from the mutation state; the reason stays for a retry.
    }
  }

  return (
    <section className="blocked-flag" aria-labelledby={`${id}-heading`}>
      <div className="task-detail__section-header">
        <h3 className="task-detail__section-title" id={`${id}-heading`}>
          Blocked
        </h3>
        {task.blocked && !disabled ? (
          <span className="button-row">
            <Button
              variant="ghost"
              onClick={() => {
                setReason(task.blocked?.reason ?? "");
                setEditing(true);
              }}
            >
              Change reason
            </Button>
            <Button
              variant="ghost"
              loading={clear.isPending}
              onClick={() => clear.mutate(task)}
            >
              Clear blocked
            </Button>
          </span>
        ) : null}
      </div>

      {task.blocked ? (
        <p className="blocked-flag__reason" data-testid="blocked-reason">
          <strong>Blocked:</strong> {task.blocked.reason}{" "}
          <span className="task-detail__hint">
            since {new Date(task.blocked.since).toLocaleString()}
          </span>
        </p>
      ) : editing ? null : (
        <p className="task-detail__hint">
          Not flagged.{" "}
          {disabled || task.isCompleted ? null : (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Mark blocked
            </Button>
          )}
        </p>
      )}

      {editing ? (
        <form
          className="blocked-flag__form"
          aria-label="Mark blocked"
          onSubmit={submit}
        >
          <label className="ml-field__label" htmlFor={`${id}-reason`}>
            Why is this task blocked?
          </label>
          <div className="tag-picker__form">
            <TextInput
              id={`${id}-reason`}
              value={reason}
              maxLength={500}
              autoComplete="off"
              autoFocus
              placeholder="Waiting on…"
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              loading={set.isPending}
              disabled={!reason.trim()}
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {failure ? (
        <Alert tone="error">
          {failure instanceof Error
            ? failure.message
            : "The flag could not be changed."}
        </Alert>
      ) : null}
    </section>
  );
}
