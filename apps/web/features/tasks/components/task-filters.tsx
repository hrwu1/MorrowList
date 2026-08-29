"use client";

import type { Priority } from "@morrowlist/contracts";
import { Button, Select } from "@morrowlist/ui";
import { useId } from "react";

import {
  COMPLETIONS,
  DEFAULT_VIEW,
  DUE_FILTERS,
  ORDERS,
  PRIORITIES,
  SORTS,
  type Completion,
  type DueFilter,
  type TaskOrder,
  type TaskSort,
  type TaskView,
} from "../lib/task-view";

import { PRIORITY_LABELS } from "./task-fields";

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

const COMPLETION_LABELS: Record<Completion, string> = {
  open: "Open only",
  done: "Completed only",
  any: "Open and completed",
};

export interface TaskFiltersProps {
  readonly view: TaskView;
  readonly onChange: (view: TaskView) => void;
  /** Completed and Trash fix the completion state, so the control would be a lie there. */
  readonly showCompletion?: boolean | undefined;
  readonly resultCount: number;
}

export function TaskFilters({
  view,
  onChange,
  showCompletion = true,
  resultCount,
}: TaskFiltersProps) {
  const id = useId();
  const isDefault =
    view.priority === DEFAULT_VIEW.priority &&
    view.due === DEFAULT_VIEW.due &&
    view.sort === DEFAULT_VIEW.sort &&
    view.order === DEFAULT_VIEW.order &&
    (!showCompletion || view.completion === DEFAULT_VIEW.completion);

  return (
    <section className="filters" aria-label="Filter and sort">
      <div className="filters__control">
        <label className="ml-field__label" htmlFor={`${id}-priority`}>
          Priority
        </label>
        <Select
          id={`${id}-priority`}
          value={view.priority}
          onChange={(event) =>
            onChange({ ...view, priority: event.target.value as Priority | "any" })
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
        <Button onClick={() => onChange(DEFAULT_VIEW)} disabled={isDefault}>
          Reset
        </Button>
      </div>

      {/* Announces how the list changed, which a purely visual result count does not. */}
      <output className="filters__count" aria-live="polite">
        {resultCount} {resultCount === 1 ? "task" : "tasks"}
      </output>
    </section>
  );
}
