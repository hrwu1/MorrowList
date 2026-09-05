"use client";

import type { Priority, TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
import { Alert, Button, Select } from "@morrowlist/ui";
import { useEffect, useId, useState, type ReactNode } from "react";

import { useBulkTasks } from "../hooks/use-bulk-tasks";
import {
  SelectionContext,
  useSelection,
  useSelectionState,
} from "../hooks/use-selection";
import type { BulkAction } from "../lib/bulk";
import { selectionLabel } from "../lib/selection";
import { PRIORITIES } from "../lib/task-view";

import { DueDateInput, PRIORITY_LABELS } from "./task-fields";

import { useTags } from "@/features/tags/hooks/use-tags";

/**
 * Multi-select and the bulk toolbar (spec 10.4, GAP-08).
 *
 * The toolbar appears only once something is selected, so an ordinary list is not
 * permanently carrying a row of disabled controls. It announces the count in a live
 * region, and every action runs as one server transaction that undoes as one offer.
 */

export function SelectionProvider({
  order,
  children,
}: {
  /** The ids on screen, top to bottom: what a range and a select-all mean. */
  readonly order: readonly string[];
  readonly children: ReactNode;
}) {
  const state = useSelectionState(order);
  return (
    <SelectionContext.Provider value={state}>{children}</SelectionContext.Provider>
  );
}

/**
 * The checkbox on a row or a card. Rendered only inside a provider, so a view that does
 * not offer multi-select is unchanged. Shift-click extends from the last row touched.
 */
export function SelectionCheckbox({ task }: { readonly task: TaskDto }) {
  const selection = useSelection();
  if (!selection.enabled) return null;

  return (
    <input
      type="checkbox"
      className="selection-check"
      checked={selection.isSelected(task.id)}
      aria-label={`Select ${task.title}`}
      onChange={() => {}}
      onClick={(event) => selection.toggle(task.id, { range: event.shiftKey })}
    />
  );
}

export interface SelectionToolbarProps {
  /** Everything on screen, so the toolbar can turn ids back into tasks. */
  readonly tasks: readonly TaskDto[];
  /** Board columns, when the screen has them: bulk move needs somewhere to move to. */
  readonly statuses?: readonly WorkflowStatusDto[] | undefined;
  readonly projectId?: string | undefined;
}

export function SelectionToolbar({
  tasks,
  statuses,
  projectId,
}: SelectionToolbarProps) {
  const selection = useSelection();
  const bulk = useBulkTasks();
  const tags = useTags();
  const fieldId = useId();
  const [done, setDone] = useState("");
  const selected = selection.tasksIn(tasks);

  // The count is announced as it changes, so a keyboard user hears the working set grow
  // without having to go looking for the toolbar (spec 14).
  const announcement =
    done || (selected.length > 0 ? selectionLabel(selected.length) : "");

  useEffect(() => {
    if (selected.length === 0) setDone("");
  }, [selected.length]);

  function apply(action: BulkAction, describe: string) {
    if (selected.length === 0 || bulk.isPending) return;
    bulk.mutate(
      { action, tasks: selected },
      {
        onSuccess: () => {
          setDone(`${selected.length} tasks ${describe}.`);
          selection.clear();
        },
      },
    );
  }

  if (!selection.enabled) return null;

  return (
    <>
      <output className="ml-visually-hidden" aria-live="polite">
        {announcement}
      </output>

      {selected.length > 0 ? (
        <section
          className="selection-toolbar"
          aria-label={`Bulk actions, ${selectionLabel(selected.length)}`}
          data-busy={bulk.isPending || undefined}
        >
          <strong className="selection-toolbar__count">
            {selectionLabel(selected.length)}
          </strong>

          <Button
            variant="ghost"
            disabled={bulk.isPending}
            onClick={() => apply({ kind: "complete" }, "completed")}
          >
            Complete
          </Button>

          {statuses && projectId ? (
            <label className="selection-toolbar__control">
              <span className="ml-visually-hidden">Move selected tasks to</span>
              <Select
                value=""
                disabled={bulk.isPending}
                onChange={(event) => {
                  const statusId = event.target.value;
                  if (statusId) apply({ kind: "move", projectId, statusId }, "moved");
                }}
              >
                <option value="">Move to…</option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          <label className="selection-toolbar__control">
            <span className="ml-visually-hidden">Set priority of selected tasks</span>
            {/* A placeholder rather than a current value: a selection has many
                priorities, and the control is a command, not a field. */}
            <Select
              id={`${fieldId}-priority`}
              value=""
              disabled={bulk.isPending}
              onChange={(event) => {
                const priority = event.target.value as Priority;
                if (priority) apply({ kind: "setPriority", priority }, "reprioritised");
              }}
            >
              <option value="">Priority…</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </label>

          <label className="selection-toolbar__control">
            <span className="ml-visually-hidden">Set due date of selected tasks</span>
            <DueDateInput
              id={`${fieldId}-due`}
              value={null}
              disabled={bulk.isPending}
              onChange={(dueDate) =>
                dueDate === null
                  ? undefined
                  : apply({ kind: "setDueDate", dueDate }, "rescheduled")
              }
            />
          </label>

          <label className="selection-toolbar__control">
            <span className="ml-visually-hidden">Add a tag to selected tasks</span>
            <Select
              value=""
              disabled={bulk.isPending || (tags.data?.data.length ?? 0) === 0}
              onChange={(event) => {
                const tagId = event.target.value;
                if (tagId) apply({ kind: "addTag", tagId }, "tagged");
              }}
            >
              <option value="">Add tag…</option>
              {(tags.data?.data ?? []).map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </label>

          <Button
            variant="danger"
            disabled={bulk.isPending}
            onClick={() => apply({ kind: "delete" }, "moved to Trash")}
          >
            Delete
          </Button>

          <Button variant="ghost" onClick={selection.clear}>
            Clear
          </Button>
        </section>
      ) : null}

      {bulk.isError ? (
        <Alert tone="error" title="Nothing was changed">
          <p>
            {bulk.error instanceof Error
              ? bulk.error.message
              : "The bulk change could not be applied."}{" "}
            The whole batch is applied together or not at all, so every task is as it
            was.
          </p>
        </Alert>
      ) : null}
    </>
  );
}

/**
 * `X` toggles the focused row and `Cmd/Ctrl+A` takes the whole list, both only while the
 * focus is inside the list this is attached to. Bound here rather than globally: a
 * select-all that fires from anywhere on the page would be a surprise, and `X` has to
 * know which row the user is on. GAP-10 owns the global shortcut registry.
 */
export function useSelectionKeys(container: HTMLElement | null) {
  const selection = useSelection();

  useEffect(() => {
    if (!container || !selection.enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selection.toggleAll();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "x") return;

      const row = target?.closest<HTMLElement>("[data-task-id]");
      const id = row?.dataset.taskId;
      if (!id) return;
      event.preventDefault();
      selection.toggle(id, { range: event.shiftKey });
    }
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [container, selection]);
}
