"use client";

import { ApiClientError } from "@morrowlist/api-client";
import type { TaskDto, TaskRelationDto } from "@morrowlist/contracts";
import { Alert, Button, Select, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import { useAddTaskRelation, useRemoveTaskRelation } from "../hooks/use-relations";
import { blockedBy, blocks, relatedTo } from "../lib/relations";

import { useTaskList } from "@/features/tasks/hooks/use-tasks";
import { apiClient } from "@/lib/api-client";

/**
 * Relations of one task (spec 8.4): who blocks it, what it blocks, and related work.
 * Another task is picked by key, with a datalist of open tasks as suggestions; search
 * (GAP-02) will replace the datalist without changing the command sent.
 */

type Kind = "blocked_by" | "blocks" | "related_to";

const KIND_LABELS: Record<Kind, string> = {
  blocked_by: "Blocked by",
  blocks: "Blocks",
  related_to: "Related to",
};

export function RelationList({
  task,
  disabled = false,
}: {
  readonly task: TaskDto;
  readonly disabled?: boolean | undefined;
}) {
  const add = useAddTaskRelation();
  const remove = useRemoveTaskRelation();
  const candidates = useTaskList({ isCompleted: false, limit: 200 });
  const [kind, setKind] = useState<Kind>("blocked_by");
  const [draft, setDraft] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const id = useId();

  const groups: [Kind, TaskRelationDto[]][] = [
    ["blocked_by", blockedBy(task)],
    ["blocks", blocks(task)],
    ["related_to", relatedTo(task)],
  ];
  const known = new Set(task.relations.map((relation) => relation.task.id));
  const suggestions = (candidates.data?.data ?? []).filter(
    (candidate) => candidate.id !== task.id && !known.has(candidate.id),
  );
  const failure = lookupError ?? add.error ?? remove.error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const key = draft.trim().split(/\s+/)[0] ?? "";
    if (!key || add.isPending) return;
    setLookupError(null);
    try {
      const other =
        suggestions.find((candidate) => candidate.key === key.toUpperCase()) ??
        (await apiClient.getTask(key));
      await add.mutateAsync({
        task,
        type: kind === "related_to" ? "related_to" : "blocks",
        direction: kind === "blocked_by" ? "incoming" : "outgoing",
        other,
      });
      setDraft("");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "TASK_NOT_FOUND") {
        setLookupError(`No task called ${key}.`);
      }
      // Anything else is reported from the mutation state; the draft stays for a retry.
    }
  }

  return (
    <section className="relation-list" aria-labelledby={`${id}-heading`}>
      <h3 className="task-detail__section-title" id={`${id}-heading`}>
        Relations
      </h3>

      {task.relations.length === 0 ? (
        <p className="task-detail__hint">
          Nothing blocks this task and it blocks nothing.
        </p>
      ) : (
        groups
          .filter(([, relations]) => relations.length > 0)
          .map(([group, relations]) => (
            <div key={group} className="relation-list__group">
              <h4 className="relation-list__label">{KIND_LABELS[group]}</h4>
              <ul className="relation-list__items" aria-label={KIND_LABELS[group]}>
                {relations.map((relation) => (
                  <li
                    key={relation.id}
                    className="relation-list__item"
                    data-done={relation.task.isCompleted || undefined}
                  >
                    <span className="task-row__key">{relation.task.key}</span>
                    <Link
                      className="relation-list__title"
                      href={`/tasks/${encodeURIComponent(relation.task.key)}`}
                    >
                      {relation.task.title}
                    </Link>
                    <span className="task-detail__hint">
                      {relation.task.isCompleted ? "done" : "open"}
                    </span>
                    {disabled ? null : (
                      <Button
                        variant="ghost"
                        aria-label={`Remove relation to ${relation.task.title}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ task, relation })}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}

      {disabled ? null : (
        <form
          className="relation-list__form"
          aria-label="Add a relation"
          onSubmit={submit}
        >
          <label className="ml-visually-hidden" htmlFor={`${id}-kind`}>
            Relation type
          </label>
          <Select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            {(Object.keys(KIND_LABELS) as Kind[]).map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </Select>
          <label className="ml-visually-hidden" htmlFor={`${id}-task`}>
            Related task key
          </label>
          <TextInput
            id={`${id}-task`}
            list={`${id}-options`}
            value={draft}
            autoComplete="off"
            placeholder="Task key, e.g. ML-000003"
            disabled={add.isPending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <datalist id={`${id}-options`}>
            {suggestions.map((candidate) => (
              <option key={candidate.id} value={candidate.key}>
                {candidate.title}
              </option>
            ))}
          </datalist>
          <Button type="submit" loading={add.isPending} disabled={!draft.trim()}>
            Add
          </Button>
        </form>
      )}

      {failure ? (
        <Alert tone="error">
          {typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The relation could not be changed."}
        </Alert>
      ) : null}
    </section>
  );
}
