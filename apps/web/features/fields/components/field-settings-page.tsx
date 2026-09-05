"use client";

import type { FieldDefinitionListItemDto, FieldType } from "@morrowlist/contracts";
import { MAX_FIELDS_PER_WORKSPACE } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Select, Spinner, TextInput } from "@morrowlist/ui";
import { useId, useState, type FormEvent } from "react";

import {
  useCreateField,
  useDeleteField,
  useFields,
  useUpdateField,
} from "../hooks/use-fields";

/**
 * Workspace field management (GAP-24). The cap of ten is the design, so the page says how
 * many are left and the create form disables itself at the limit rather than letting the
 * server refuse. The key and the type are shown but never editable: changing either would
 * reinterpret the values already on tasks.
 */

export const FIELD_TYPES: readonly FieldType[] = ["select", "number", "date", "text"];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  select: "Choice",
  number: "Number",
  date: "Date",
  text: "Text",
};

/** A comma-separated option list, which is how people type one. */
function parseOptions(raw: string): string[] {
  return raw
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
}

export function FieldSettingsPage() {
  const fields = useFields();
  const create = useCreateField();
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [showOnCard, setShowOnCard] = useState(false);
  const id = useId();

  const existing = fields.data?.data ?? [];
  const remaining = MAX_FIELDS_PER_WORKSPACE - existing.length;
  const atLimit = remaining <= 0;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || atLimit) return;
    try {
      await create.mutateAsync({
        name: trimmed,
        type,
        ...(type === "select" ? { options: parseOptions(options) } : {}),
        ...(showOnCard ? { showOnCard: true } : {}),
      });
      setName("");
      setOptions("");
      setShowOnCard(false);
    } catch {
      // The error stays visible below and the name remains available to retry.
    }
  }

  return (
    <div className="tag-settings stack">
      <header className="page-header">
        <h1>Custom fields</h1>
        <p className="page-header__subtitle">
          A few typed slots on every task — a choice, a number, a date, a note. A
          workspace may define {MAX_FIELDS_PER_WORKSPACE}, and no more: that limit is
          what keeps a task list from turning into a spreadsheet.
        </p>
      </header>

      <form
        className="tag-settings__create"
        aria-label="Define a field"
        onSubmit={onCreate}
      >
        <div className="tag-settings__field">
          <label className="ml-field__label" htmlFor={`${id}-name`}>
            Field name
          </label>
          <TextInput
            id={`${id}-name`}
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder="For example, Effort"
            disabled={atLimit}
            onChange={(event) => {
              setName(event.target.value);
              if (create.isError) create.reset();
            }}
          />
        </div>
        <div className="tag-settings__field tag-settings__field--color">
          <label className="ml-field__label" htmlFor={`${id}-type`}>
            Type
          </label>
          <Select
            id={`${id}-type`}
            value={type}
            disabled={atLimit}
            onChange={(event) => setType(event.target.value as FieldType)}
          >
            {FIELD_TYPES.map((option) => (
              <option key={option} value={option}>
                {FIELD_TYPE_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>
        {type === "select" ? (
          <div className="tag-settings__field tag-settings__field--wide">
            <label className="ml-field__label" htmlFor={`${id}-options`}>
              Choices
            </label>
            <TextInput
              id={`${id}-options`}
              value={options}
              autoComplete="off"
              placeholder="Comma separated, e.g. Small, Medium, Large"
              disabled={atLimit}
              onChange={(event) => setOptions(event.target.value)}
            />
          </div>
        ) : null}
        <label className="field-settings__card-toggle">
          <input
            type="checkbox"
            checked={showOnCard}
            disabled={atLimit}
            onChange={(event) => setShowOnCard(event.target.checked)}
          />
          Show on cards
        </label>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!name.trim() || atLimit}
        >
          Create field
        </Button>
        <p className="task-detail__hint">
          {atLimit
            ? `All ${MAX_FIELDS_PER_WORKSPACE} fields are in use. Delete one to define another.`
            : `${remaining} of ${MAX_FIELDS_PER_WORKSPACE} left.`}
        </p>
        {create.isError ? (
          <div className="tag-settings__error">
            <Alert tone="error" title="The field could not be created">
              {create.error instanceof Error
                ? create.error.message
                : "Something went wrong."}
            </Alert>
          </div>
        ) : null}
      </form>

      {fields.isPending ? (
        <div className="task-list__status">
          <Spinner label="Loading fields" />
        </div>
      ) : fields.isError ? (
        <Alert tone="error" title="Fields could not be loaded">
          <p>
            {fields.error instanceof Error
              ? fields.error.message
              : "Something went wrong."}
          </p>
          <Button onClick={() => void fields.refetch()}>Try again</Button>
        </Alert>
      ) : existing.length === 0 ? (
        <EmptyState
          title="No custom fields yet"
          description="Define one above; it then appears on every task's details."
        />
      ) : (
        <ul className="tag-settings__list" aria-label="Custom fields">
          {existing.map((field) => (
            <FieldRow key={field.id} field={field} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldRow({ field }: { readonly field: FieldDefinitionListItemDto }) {
  const update = useUpdateField();
  const remove = useDeleteField();
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState(field.options.join(", "));
  const [showOnCard, setShowOnCard] = useState(field.showOnCard);
  const [confirming, setConfirming] = useState(false);
  const id = useId();

  const dirty =
    name.trim() !== field.name ||
    showOnCard !== field.showOnCard ||
    (field.type === "select" &&
      parseOptions(options).join(",") !== field.options.join(","));
  const taskLabel = `${field.taskCount} ${field.taskCount === 1 ? "task" : "tasks"}`;

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !name.trim()) return;
    try {
      await update.mutateAsync({
        field,
        patch: {
          ...(name.trim() !== field.name ? { name: name.trim() } : {}),
          ...(showOnCard !== field.showOnCard ? { showOnCard } : {}),
          ...(field.type === "select" ? { options: parseOptions(options) } : {}),
        },
      });
    } catch {
      // Reported below; the edits stay so the user can fix and retry.
    }
  }

  return (
    <li className="tag-settings__row">
      <form
        className="tag-settings__edit"
        aria-label={`Edit field ${field.name}`}
        onSubmit={onSave}
      >
        <div className="tag-settings__preview">
          <code className="field-settings__key">{field.key}</code>
          <span className="task-detail__hint">
            {FIELD_TYPE_LABELS[field.type]} · {taskLabel}
          </span>
        </div>
        <div className="tag-settings__field">
          <label className="ml-field__label" htmlFor={`${id}-name`}>
            Name
          </label>
          <TextInput
            id={`${id}-name`}
            value={name}
            maxLength={80}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (update.isError) update.reset();
            }}
          />
        </div>
        {field.type === "select" ? (
          <div className="tag-settings__field tag-settings__field--wide">
            <label className="ml-field__label" htmlFor={`${id}-options`}>
              Choices
            </label>
            <TextInput
              id={`${id}-options`}
              value={options}
              autoComplete="off"
              onChange={(event) => setOptions(event.target.value)}
            />
          </div>
        ) : null}
        <label className="field-settings__card-toggle">
          <input
            type="checkbox"
            checked={showOnCard}
            onChange={(event) => setShowOnCard(event.target.checked)}
          />
          Show on cards
        </label>
        <div className="tag-settings__actions">
          <Button
            type="submit"
            variant="primary"
            loading={update.isPending}
            disabled={!dirty || !name.trim()}
          >
            Save
          </Button>
          {confirming ? (
            <>
              <Button
                variant="danger"
                loading={remove.isPending}
                aria-label={`Confirm deleting ${field.name}`}
                onClick={() => remove.mutate(field)}
              >
                Clear from {taskLabel}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              aria-label={`Delete ${field.name}`}
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          )}
        </div>
        {update.isError || remove.isError ? (
          <div className="tag-settings__error">
            <Alert tone="error">
              {(update.error ?? remove.error) instanceof Error
                ? (update.error ?? remove.error)?.message
                : "The field could not be changed."}
            </Alert>
          </div>
        ) : null}
      </form>
    </li>
  );
}
