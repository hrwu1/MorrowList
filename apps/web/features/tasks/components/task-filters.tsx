"use client";

import type { Priority } from "@morrowlist/contracts";
import { Button, Select } from "@morrowlist/ui";
import { useId } from "react";

import {
  BLOCKED_FILTERS,
  COMPLETIONS,
  DEFAULT_VIEW,
  DUE_FILTERS,
  ORDERS,
  PRIORITIES,
  SORTS,
  type BlockedFilter,
  type Completion,
  type DueFilter,
  type TaskOrder,
  type TaskSort,
  type TaskView,
} from "../lib/task-view";

import { PRIORITY_LABELS } from "./task-fields";

import { useTags } from "@/features/tags/hooks/use-tags";

/**
 * Filter and sort controls (VIEW-002, spec 9.4).
 *
 * The controls write straight to the URL, so the view they describe can be copied out of
 * the address bar and survives a reload. There is no Apply button: each control is a
 * committed choice on change.
 */

const DUE_LABELS: Record<DueFilter, string> = {
  overdue: "Overdue",
  today: "Due today",
  future: "Due later",
  none: "No due date",
};

const SORT_LABELS: Record<TaskSort, string> = {
  rank: "Manual order",
  createdAt: "Created",
  dueDate: "Due date",
  priority: "Priority",
  updatedAt: "Last updated",
};

const ORDER_LABELS: Record<TaskOrder, string> = {
  asc: "Ascending",
  desc: "Descending",
};

const BLOCKED_LABELS: Record<BlockedFilter, string> = {
  yes: "Blocked only",
  no: "Not blocked",
};

const COMPLETION_LABELS: Record<Completion, string> = {
  open: "Open only",
  done: "Completed only",
  any: "Open and completed",
};

export interface TaskFiltersProps {
  readonly view: TaskView;
  /** The route's clean state. Completed and Trash intentionally use different defaults. */
  readonly base?: TaskView | undefined;
  readonly onChange: (view: TaskView) => void;
  /** Completed and Trash fix the completion state, so the control would be a lie there. */
  readonly showCompletion?: boolean | undefined;
  readonly resultCount: number;
}

export function TaskFilters({
  view,
  base = DEFAULT_VIEW,
  onChange,
  showCompletion = true,
  resultCount,
}: TaskFiltersProps) {
  const id = useId();
  const tags = useTags();
  const tagItems = tags.data?.data ?? [];
  const activeTag = tagItems.find((tag) => tag.id === view.tag);
  const isDefault =
    view.priority === base.priority &&
    view.due === base.due &&
    view.tag === base.tag &&
    view.blocked === base.blocked &&
    view.sort === base.sort &&
    view.order === base.order &&
    (!showCompletion || view.completion === base.completion);
  const activeChoices = [
    ...(view.priority === base.priority
      ? []
      : [
          view.priority === "any"
            ? "Any priority"
            : `${PRIORITY_LABELS[view.priority]} priority`,
        ]),
    ...(view.due === base.due
      ? []
      : [view.due === "any" ? "Any due date" : DUE_LABELS[view.due]]),
    ...(view.tag === base.tag
      ? []
      : [view.tag === "any" ? "Any tag" : `Tag: ${activeTag?.name ?? "…"}`]),
    ...(!showCompletion || view.completion === base.completion
      ? []
      : [COMPLETION_LABELS[view.completion]]),
    ...(view.blocked === base.blocked
      ? []
      : [view.blocked === "any" ? "Any blocked state" : BLOCKED_LABELS[view.blocked]]),
    ...(view.sort === base.sort ? [] : [SORT_LABELS[view.sort]]),
    ...(view.order === base.order ? [] : [ORDER_LABELS[view.order]]),
  ];

  return (
    <section className="filters" aria-label="Filter and sort">
      <details className="view-disclosure">
        <summary className="view-disclosure__summary">
          <span className="view-disclosure__summary-label">View</span>
          <span className="view-disclosure__chips">
            {activeChoices.length === 0 ? (
              <span className="view-disclosure__chip">Default</span>
            ) : (
              activeChoices.map((choice) => (
                <span className="view-disclosure__chip" data-active key={choice}>
                  {choice}
                </span>
              ))
            )}
            {/* Announces list changes even while the controls are collapsed. */}
            <output className="view-disclosure__count" aria-live="polite">
              {resultCount} {resultCount === 1 ? "task" : "tasks"}
            </output>
          </span>
        </summary>

        <div className="view-disclosure__panel filters__panel">
          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-priority`}>
              Priority
            </label>
            <Select
              id={`${id}-priority`}
              value={view.priority}
              onChange={(event) =>
                onChange({
                  ...view,
                  priority: event.target.value as Priority | "any",
                })
              }
            >
              <option value="any">Any priority</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </div>

          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-due`}>
              Due
            </label>
            <Select
              id={`${id}-due`}
              value={view.due}
              onChange={(event) =>
                onChange({ ...view, due: event.target.value as DueFilter | "any" })
              }
            >
              <option value="any">Any due date</option>
              {DUE_FILTERS.map((due) => (
                <option key={due} value={due}>
                  {DUE_LABELS[due]}
                </option>
              ))}
            </Select>
          </div>

          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-tag`}>
              Tag
            </label>
            <Select
              id={`${id}-tag`}
              value={activeTag ? view.tag : "any"}
              disabled={tags.isPending}
              onChange={(event) => onChange({ ...view, tag: event.target.value })}
            >
              <option value="any">Any tag</option>
              {tagItems.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </div>

          {showCompletion ? (
            <div className="filters__control">
              <label className="ml-field__label" htmlFor={`${id}-completed`}>
                Completion
              </label>
              <Select
                id={`${id}-completed`}
                value={view.completion}
                onChange={(event) =>
                  onChange({ ...view, completion: event.target.value as Completion })
                }
              >
                {COMPLETIONS.map((completion) => (
                  <option key={completion} value={completion}>
                    {COMPLETION_LABELS[completion]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-blocked`}>
              Blocked
            </label>
            <Select
              id={`${id}-blocked`}
              value={view.blocked}
              onChange={(event) =>
                onChange({
                  ...view,
                  blocked: event.target.value as BlockedFilter | "any",
                })
              }
            >
              <option value="any">Any blocked state</option>
              {BLOCKED_FILTERS.map((blocked) => (
                <option key={blocked} value={blocked}>
                  {BLOCKED_LABELS[blocked]}
                </option>
              ))}
            </Select>
          </div>

          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-sort`}>
              Sort by
            </label>
            <Select
              id={`${id}-sort`}
              value={view.sort}
              onChange={(event) =>
                onChange({ ...view, sort: event.target.value as TaskSort })
              }
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </Select>
          </div>

          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-order`}>
              Order
            </label>
            <Select
              id={`${id}-order`}
              value={view.order}
              onChange={(event) =>
                onChange({ ...view, order: event.target.value as TaskOrder })
              }
            >
              {ORDERS.map((order) => (
                <option key={order} value={order}>
                  {ORDER_LABELS[order]}
                </option>
              ))}
            </Select>
          </div>

          <div className="filters__control filters__control--end">
            <Button onClick={() => onChange(base)} disabled={isDefault}>
              Reset
            </Button>
          </div>
        </div>
      </details>
    </section>
  );
}
