"use client";

import type { TagColorToken, TagListItemDto } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Select, Spinner, TextInput } from "@morrowlist/ui";
import { useId, useState, type FormEvent } from "react";

import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from "../hooks/use-tags";

import { TagChip } from "./tag-chip";

/** The palette from `packages/ui/src/tokens.css`; every token has a light and dark pair. */
export const TAG_COLORS: readonly TagColorToken[] = [
  "neutral",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
];

const COLOR_LABELS: Record<TagColorToken, string> = {
  neutral: "Neutral",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
};

function ColorSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  readonly id: string;
  readonly value: TagColorToken;
  readonly onChange: (value: TagColorToken) => void;
  readonly disabled?: boolean | undefined;
}) {
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as TagColorToken)}
    >
      {TAG_COLORS.map((token) => (
        <option key={token} value={token}>
          {COLOR_LABELS[token]}
        </option>
      ))}
    </Select>
  );
}

/** Workspace tag management: create, rename, recolour, describe, and delete (spec 12.1). */
export function TagSettingsPage() {
  const tags = useTags();
  const create = useCreateTag();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColorToken>("neutral");
  const id = useId();

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed, colorToken: color });
      setName("");
      setColor("neutral");
    } catch {
      // The error stays visible below and the name remains available to retry.
    }
  }

  return (
    <div className="tag-settings stack">
      <header className="page-header">
        <h1>Tags</h1>
        <p className="page-header__subtitle">
          Labels that cut across projects. Renaming or recolouring a tag updates every
          task that carries it.
        </p>
      </header>

      <form
        className="tag-settings__create"
        aria-label="Create a tag"
        onSubmit={onCreate}
      >
        <div className="tag-settings__field">
          <label className="ml-field__label" htmlFor={`${id}-name`}>
            Tag name
          </label>
          <TextInput
            id={`${id}-name`}
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder="For example, Deep Work"
            onChange={(event) => {
              setName(event.target.value);
              if (create.isError) create.reset();
            }}
          />
        </div>
        <div className="tag-settings__field tag-settings__field--color">
          <label className="ml-field__label" htmlFor={`${id}-color`}>
            Colour
          </label>
          <ColorSelect id={`${id}-color`} value={color} onChange={setColor} />
        </div>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!name.trim()}
        >
          Create tag
        </Button>
        {create.isError ? (
          <div className="tag-settings__error">
            <Alert tone="error" title="The tag could not be created">
              {create.error instanceof Error
                ? create.error.message
                : "Something went wrong."}
            </Alert>
          </div>
        ) : null}
      </form>

      {tags.isPending ? (
        <div className="task-list__status">
          <Spinner label="Loading tags" />
        </div>
      ) : tags.isError ? (
        <Alert tone="error" title="Tags could not be loaded">
          <p>
            {tags.error instanceof Error ? tags.error.message : "Something went wrong."}
          </p>
          <Button onClick={() => void tags.refetch()}>Try again</Button>
        </Alert>
      ) : tags.data.data.length === 0 ? (
        <EmptyState
          title="No tags yet"
          description="Create one above, or add a tag from any task's details."
        />
      ) : (
        <ul className="tag-settings__list" aria-label="Tags">
          {tags.data.data.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TagRow({ tag }: { readonly tag: TagListItemDto }) {
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColorToken>(tag.colorToken);
  const [description, setDescription] = useState(tag.description ?? "");
  const [confirming, setConfirming] = useState(false);
  const id = useId();

  const dirty =
    name.trim() !== tag.name ||
    color !== tag.colorToken ||
    description.trim() !== (tag.description ?? "");
  const taskLabel = `${tag.taskCount} ${tag.taskCount === 1 ? "task" : "tasks"}`;

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !name.trim()) return;
    try {
      await update.mutateAsync({
        tag,
        patch: {
          ...(name.trim() !== tag.name ? { name: name.trim() } : {}),
          ...(color !== tag.colorToken ? { colorToken: color } : {}),
          ...(description.trim() !== (tag.description ?? "")
            ? { description: description.trim() || null }
            : {}),
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
        aria-label={`Edit tag ${tag.name}`}
        onSubmit={onSave}
      >
        <div className="tag-settings__preview">
          <TagChip tag={{ ...tag, name: name.trim() || tag.name, colorToken: color }} />
          <span className="task-detail__hint">{taskLabel}</span>
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
        <div className="tag-settings__field tag-settings__field--color">
          <label className="ml-field__label" htmlFor={`${id}-color`}>
            Colour
          </label>
          <ColorSelect id={`${id}-color`} value={color} onChange={setColor} />
        </div>
        <div className="tag-settings__field tag-settings__field--wide">
          <label className="ml-field__label" htmlFor={`${id}-description`}>
            Description
          </label>
          <TextInput
            id={`${id}-description`}
            value={description}
            maxLength={500}
            autoComplete="off"
            placeholder="Optional"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
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
                aria-label={`Confirm deleting ${tag.name}`}
                onClick={() => remove.mutate(tag)}
              >
                Remove from {taskLabel}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              aria-label={`Delete ${tag.name}`}
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
                : "The tag could not be changed."}
            </Alert>
          </div>
        ) : null}
      </form>
    </li>
  );
}
