"use client";

import type { Priority } from "@morrowlist/contracts";
import { Select, TextInput } from "@morrowlist/ui";

import { PRIORITIES } from "../lib/task-view";

/**
 * The controls that edit a task's priority and due date, shared by quick-add, the row
 * actions, and the detail panel so the same field behaves the same everywhere.
 *
 * All three are native controls: they come with keyboard support, mobile pickers, and
 * correct semantics rather than an approximation of them (spec 14).
 */

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export interface PrioritySelectProps {
  readonly id: string;
  readonly value: Priority;
  readonly onChange: (value: Priority) => void;
  readonly disabled?: boolean | undefined;
}

export function PrioritySelect({ id, value, onChange, disabled }: PrioritySelectProps) {
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as Priority)}
    >
      {PRIORITIES.map((priority) => (
        <option key={priority} value={priority}>
          {PRIORITY_LABELS[priority]}
        </option>
      ))}
    </Select>
  );
}

export interface DateInputProps {
  readonly id: string;
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly disabled?: boolean | undefined;
}

/** An empty date field means "no due date", which the API spells as an explicit null. */
export function DueDateInput({ id, value, onChange, disabled }: DateInputProps) {
  return (
    <TextInput
      id={id}
      type="date"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) =>
        onChange(event.target.value === "" ? null : event.target.value)
      }
    />
  );
}

export interface DueTimeInputProps extends DateInputProps {
  /** A due time is invalid without a due date (spec 8.2 invariant 3). */
  readonly hasDueDate: boolean;
}

export function DueTimeInput({
  id,
  value,
  onChange,
  disabled,
  hasDueDate,
}: DueTimeInputProps) {
  return (
    <TextInput
      id={id}
      type="time"
      value={value ?? ""}
      disabled={disabled || !hasDueDate}
      aria-describedby={hasDueDate ? undefined : `${id}-hint`}
      onChange={(event) =>
        onChange(event.target.value === "" ? null : event.target.value)
      }
    />
  );
}

/**
 * Priority as text with a matching colour, never colour alone (spec 14). Rendered only
 * for a real priority: "none" is the absence of a signal, not a signal.
 */
export function PriorityBadge({ priority }: { readonly priority: Priority }) {
  if (priority === "none") return null;
  return (
    <span className="task-row__priority" data-priority={priority}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

/** A due date, marked as overdue in words as well as in colour. */
export function DueBadge({
  dueDate,
  dueTime,
  isCompleted,
}: {
  readonly dueDate: string | null;
  readonly dueTime: string | null;
  readonly isCompleted: boolean;
}) {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !isCompleted && dueDate < today;

  return (
    <time
      className="task-row__due"
      dateTime={dueTime ? `${dueDate}T${dueTime}` : dueDate}
      data-overdue={overdue || undefined}
    >
      {overdue ? "Overdue: " : "Due "}
      {dueDate}
      {dueTime ? ` at ${dueTime}` : ""}
    </time>
  );
}
