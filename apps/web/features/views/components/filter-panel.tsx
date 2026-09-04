"use client";

import type { Priority, SavedViewDto } from "@morrowlist/contracts";
import { Button, Select, TextInput } from "@morrowlist/ui";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import {
  useCreateSavedView,
  useDeleteSavedView,
  useUpdateSavedView,
} from "../hooks/use-saved-views";

import { useProjects } from "@/features/projects/hooks/use-projects";
import { useTags } from "@/features/tags/hooks/use-tags";
import { PRIORITY_LABELS } from "@/features/tasks/components/task-fields";
import {
  BLOCKED_FILTERS,
  COMPLETIONS,
  DEADLINE_FILTERS,
  DEFERRED_FILTERS,
  DEFAULT_VIEW,
  DUE_FILTERS,
  ORDERS,
  PRIORITIES,
  SORTS,
  filtersFromView,
  type BlockedFilter,
  type Completion,
  type DeadlineFilter,
  type DeferredFilter,
  type DueFilter,
  type TaskOrder,
  type TaskScope,
  type TaskSort,
  type TaskView,
} from "@/features/tasks/lib/task-view";

/**
 * The filter panel (spec 9.8, GAP-02): every filter and sort of a list, written straight
 * to the URL so the view survives a reload, plus saving the current set as a personal
 * view. On a saved view it also updates, renames, and deletes that view. There is no
 * Apply button: each control is a committed choice on change.
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

const DEFERRED_LABELS: Record<DeferredFilter, string> = {
  yes: "Deferred only",
  no: "Not deferred",
};

const DEADLINE_LABELS: Record<DeadlineFilter, string> = {
  overdue: "Past deadline",
  week: "Deadline within a week",
  none: "No deadline",
};

const COMPLETION_LABELS: Record<Completion, string> = {
  open: "Open only",
  done: "Completed only",
  any: "Open and completed",
};

export interface FilterPanelProps {
  readonly scope: TaskScope;
  readonly view: TaskView;
  /** The route's clean state. Completed, Trash and saved views use different defaults. */
  readonly base?: TaskView | undefined;
  readonly onChange: (view: TaskView) => void;
  /** Completed and Trash fix the completion state, so the control would be a lie there. */
  readonly showCompletion?: boolean | undefined;
  /** Search results are ordered by relevance, so the sort controls are hidden there. */
  readonly showSort?: boolean | undefined;
  /** The Inbox and All scopes can be saved; Trash and search cannot. */
  readonly allowSave?: boolean | undefined;
  /** The saved view this list is showing, when it is one. */
  readonly savedView?: SavedViewDto | undefined;
  readonly resultCount: number;
}

export function FilterPanel({
  scope,
  view,
  base = DEFAULT_VIEW,
  onChange,
  showCompletion = true,
  showSort = true,
  allowSave = true,
  savedView,
  resultCount,
}: FilterPanelProps) {
  const id = useId();
  const tags = useTags();
  const projects = useProjects();
  const tagItems = tags.data?.data ?? [];
  const projectItems = projects.data?.data ?? [];
  const activeTag = tagItems.find((tag) => tag.id === view.tag);
  const activeProject = projectItems.find((project) => project.id === view.project);
  const isDefault =
    view.project === base.project &&
    view.priority === base.priority &&
    view.due === base.due &&
    view.tag === base.tag &&
    view.blocked === base.blocked &&
    view.deferred === base.deferred &&
    view.deadline === base.deadline &&
    (!showSort || (view.sort === base.sort && view.order === base.order)) &&
    (!showCompletion || view.completion === base.completion);
  const activeChoices = [
    ...(view.project === base.project
      ? []
      : [
          view.project === "any"
            ? "Any project"
            : `Project: ${activeProject?.name ?? "…"}`,
        ]),
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
    ...(view.blocked === base.blocked
      ? []
      : [view.blocked === "any" ? "Any blocked state" : BLOCKED_LABELS[view.blocked]]),
    ...(view.deferred === base.deferred
      ? []
      : [view.deferred === "any" ? "Any deferral" : DEFERRED_LABELS[view.deferred]]),
    ...(view.deadline === base.deadline
      ? []
      : [view.deadline === "any" ? "Any deadline" : DEADLINE_LABELS[view.deadline]]),
    ...(!showCompletion || view.completion === base.completion
      ? []
      : [COMPLETION_LABELS[view.completion]]),
    ...(!showSort || view.sort === base.sort ? [] : [SORT_LABELS[view.sort]]),
    ...(!showSort || view.order === base.order ? [] : [ORDER_LABELS[view.order]]),
  ];

  return (
    <section className="filters" aria-label="Filter and sort">
      <details className="view-disclosure">
        <summary className="view-disclosure__summary">
          <span className="view-disclosure__summary-label">View</span>
          <span className="view-disclosure__chips">
            {activeChoices.length === 0 ? (
              <span className="view-disclosure__chip">
                {savedView ? "As saved" : "Default"}
              </span>
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
          {scope !== "inbox" ? (
            <div className="filters__control">
              <label className="ml-field__label" htmlFor={`${id}-project`}>
                Project
              </label>
              <Select
                id={`${id}-project`}
                value={activeProject ? view.project : "any"}
                disabled={projects.isPending}
                onChange={(event) => onChange({ ...view, project: event.target.value })}
              >
                <option value="any">Any project</option>
                {projectItems.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

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
            <label className="ml-field__label" htmlFor={`${id}-deferred`}>
              Deferred
            </label>
            <Select
              id={`${id}-deferred`}
              value={view.deferred}
              onChange={(event) =>
                onChange({
                  ...view,
                  deferred: event.target.value as DeferredFilter | "any",
                })
              }
            >
              <option value="any">Any deferral</option>
              {DEFERRED_FILTERS.map((deferred) => (
                <option key={deferred} value={deferred}>
                  {DEFERRED_LABELS[deferred]}
                </option>
              ))}
            </Select>
          </div>

          <div className="filters__control">
            <label className="ml-field__label" htmlFor={`${id}-deadline`}>
              Deadline
            </label>
            <Select
              id={`${id}-deadline`}
              value={view.deadline}
              onChange={(event) =>
                onChange({
                  ...view,
                  deadline: event.target.value as DeadlineFilter | "any",
                })
              }
            >
              <option value="any">Any deadline</option>
              {DEADLINE_FILTERS.map((deadline) => (
                <option key={deadline} value={deadline}>
                  {DEADLINE_LABELS[deadline]}
                </option>
              ))}
            </Select>
          </div>

          {showSort ? (
            <>
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
            </>
          ) : null}

          <div className="filters__control filters__control--end">
            <Button onClick={() => onChange(base)} disabled={isDefault}>
              {savedView ? "Back to saved" : "Reset"}
            </Button>
          </div>

          {allowSave ? (
            <SavedViewActions
              scope={scope}
              view={view}
              savedView={savedView}
              changed={!isDefault}
            />
          ) : null}
        </div>
      </details>
    </section>
  );
}

/** Save the current filters as a view, or update, rename, and delete the current one. */
function SavedViewActions({
  scope,
  view,
  savedView,
  changed,
}: {
  readonly scope: TaskScope;
  readonly view: TaskView;
  readonly savedView: SavedViewDto | undefined;
  readonly changed: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const create = useCreateSavedView();
  const update = useUpdateSavedView();
  const remove = useDeleteSavedView();
  const [name, setName] = useState(savedView?.name ?? "");
  const [confirming, setConfirming] = useState(false);
  const id = useId();
  const busy = create.isPending || update.isPending || remove.isPending;
  const error = create.error ?? update.error ?? remove.error;

  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    try {
      if (savedView) {
        await update.mutateAsync({ view: savedView, patch: { name: trimmed } });
      } else {
        const created = await create.mutateAsync({
          name: trimmed,
          filters: filtersFromView(scope, view),
          layout: "list",
        });
        setName("");
        router.push(`/views/${created.id}`);
      }
    } catch {
      // The error stays visible below; the name remains available to retry.
    }
  }

  async function updateFilters() {
    if (!savedView || busy) return;
    try {
      await update.mutateAsync({
        view: savedView,
        patch: { filters: filtersFromView(scope, view) },
      });
      // The saved filters are now the base, so the URL overrides are no longer needed.
      router.replace(pathname, { scroll: false });
    } catch {
      // Reported below.
    }
  }

  async function deleteView() {
    if (!savedView || busy) return;
    try {
      await remove.mutateAsync(savedView);
      router.push("/inbox");
    } catch {
      setConfirming(false);
    }
  }

  return (
    <form
      className="filters__save"
      aria-label={savedView ? `Manage view ${savedView.name}` : "Save as view"}
      aria-busy={busy}
      onSubmit={(event) => void save(event)}
    >
      <label className="ml-field__label" htmlFor={`${id}-name`}>
        {savedView ? "View name" : "Save as view"}
      </label>
      <div className="filters__save-row">
        <TextInput
          id={`${id}-name`}
          value={name}
          maxLength={100}
          placeholder="Name this view"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
          {savedView ? "Rename" : "Save view"}
        </Button>
        {savedView ? (
          <>
            <Button
              type="button"
              disabled={!changed || busy}
              onClick={() => void updateFilters()}
            >
              Update filters
            </Button>
            {confirming ? (
              <Button
                type="button"
                variant="danger"
                aria-label={`Confirm deleting view ${savedView.name}`}
                onClick={() => void deleteView()}
              >
                Confirm delete
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                aria-label={`Delete view ${savedView.name}`}
                onClick={() => setConfirming(true)}
              >
                Delete view
              </Button>
            )}
          </>
        ) : null}
      </div>
      {error ? (
        <p className="filters__save-error" role="alert">
          {error instanceof Error ? error.message : "The view could not be saved."}
        </p>
      ) : null}
    </form>
  );
}
