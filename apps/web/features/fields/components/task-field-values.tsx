"use client";

import type { FieldDefinitionDto, FieldValueDto, TaskDto } from "@morrowlist/contracts";
import { Alert, Select, TextInput } from "@morrowlist/ui";
import { useId } from "react";

import { useFields } from "../hooks/use-fields";

import { useUpdateTask } from "@/features/tasks/hooks/use-tasks";

/**
 * The typed custom fields of a task (GAP-24). Every field the workspace defines has a
 * control here whether or not the task carries a value, so the section reads as the
 * task's shape rather than as a list of what happens to be filled in. Clearing a control
 * sends an explicit null, which removes the key.
 */
export function TaskFieldValues({
  task,
  disabled = false,
}: {
  readonly task: TaskDto;
  readonly disabled?: boolean | undefined;
}) {
  const fields = useFields();
  const update = useUpdateTask();
  const id = useId();

  const definitions = fields.data?.data ?? [];
  if (definitions.length === 0) return null;

  const send = (definition: FieldDefinitionDto, raw: string) => {
    const value: FieldValueDto | null =
      raw.trim().length === 0 ? null : definition.type === "number" ? Number(raw) : raw;
    if (definition.type === "number" && value !== null && Number.isNaN(value)) return;
    update.mutate({ task, patch: { fields: { [definition.key]: value } } });
  };

  return (
    <section className="task-fields" aria-labelledby={`${id}-label`}>
      <h3 className="task-detail__section-title" id={`${id}-label`}>
        Fields
      </h3>
      <div className="task-fields__grid">
        {definitions.map((definition) => {
          const current = task.fields[definition.key];
          const controlId = `${id}-${definition.key}`;
          return (
            <div className="filters__control" key={definition.id}>
              <label className="ml-field__label" htmlFor={controlId}>
                {definition.name}
              </label>
              {definition.type === "select" ? (
                <Select
                  id={controlId}
                  value={current === undefined ? "" : String(current)}
                  disabled={disabled}
                  onChange={(event) => send(definition, event.target.value)}
                >
                  <option value="">Not set</option>
                  {definition.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : (
                <TextInput
                  id={controlId}
                  type={
                    definition.type === "number"
                      ? "number"
                      : definition.type === "date"
                        ? "date"
                        : "text"
                  }
                  defaultValue={current === undefined ? "" : String(current)}
                  maxLength={definition.type === "text" ? 200 : undefined}
                  disabled={disabled}
                  // Committed on blur rather than on every keystroke: a field value is a
                  // small, deliberate edit, not prose.
                  onBlur={(event) => {
                    const next = event.target.value;
                    if (next === (current === undefined ? "" : String(current))) return;
                    send(definition, next);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {update.isError ? (
        <Alert tone="error">
          {update.error instanceof Error
            ? update.error.message
            : "The field could not be saved."}
        </Alert>
      ) : null}
    </section>
  );
}
