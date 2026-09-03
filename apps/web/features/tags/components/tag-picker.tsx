"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { Alert, Button, TextInput } from "@morrowlist/ui";
import { useId, useState, type FormEvent } from "react";

import {
  useAddTaskTag,
  useCreateTag,
  useRemoveTaskTag,
  useTags,
} from "../hooks/use-tags";
import { findTagByName } from "../lib/tags";

import { TagChip } from "./tag-chip";

/**
 * The tag field of a task (spec 10.2). Typing a name and pressing Enter attaches an
 * existing tag or creates it first; the native datalist offers the workspace's tags with
 * the platform's own keyboard and mobile behaviour (spec 14).
 */
export function TagPicker({
  task,
  disabled = false,
}: {
  readonly task: TaskDto;
  readonly disabled?: boolean | undefined;
}) {
  const tags = useTags();
  const add = useAddTaskTag();
  const remove = useRemoveTaskTag();
  const create = useCreateTag();
  const [draft, setDraft] = useState("");
  const id = useId();

  const known = tags.data?.data ?? [];
  const available = known.filter(
    (tag) => !task.tags.some((current) => current.id === tag.id),
  );
  const busy = add.isPending || create.isPending;
  const failure = add.error ?? create.error ?? remove.error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;

    try {
      const existing = findTagByName(known, name);
      if (existing && task.tags.some((current) => current.id === existing.id)) {
        setDraft("");
        return;
      }
      const tag = existing ?? (await create.mutateAsync({ name }));
      await add.mutateAsync({ task, tag });
      setDraft("");
    } catch {
      // Reported below from the mutation state; the draft stays for a retry.
    }
  }

  return (
    <div className="tag-picker">
      <span className="ml-field__label" id={`${id}-label`}>
        Tags
      </span>
      {task.tags.length > 0 ? (
        <ul className="tag-chips" aria-labelledby={`${id}-label`}>
          {task.tags.map((tag) => (
            <li key={tag.id}>
              <TagChip
                tag={tag}
                onRemove={disabled ? undefined : () => remove.mutate({ task, tag })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="task-detail__hint">No tags yet.</p>
      )}

      {disabled ? null : (
        <form className="tag-picker__form" aria-label="Tag picker" onSubmit={submit}>
          <label className="ml-visually-hidden" htmlFor={`${id}-input`}>
            Add tag
          </label>
          <TextInput
            id={`${id}-input`}
            list={`${id}-options`}
            value={draft}
            maxLength={80}
            autoComplete="off"
            placeholder="Add a tag and press Enter"
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <datalist id={`${id}-options`}>
            {available.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
          <Button type="submit" loading={busy} disabled={!draft.trim()}>
            Add
          </Button>
        </form>
      )}

      {failure ? (
        <Alert tone="error">
          {failure instanceof Error ? failure.message : "The tag could not be changed."}
        </Alert>
      ) : null}
    </div>
  );
}
