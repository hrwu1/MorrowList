"use client";

import type { SavedViewDto } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { useTaskList } from "../hooks/use-tasks";
import {
  DEFAULT_VIEW,
  readTaskView,
  toListQuery,
  writeTaskView,
  type TaskScope,
  type TaskView,
} from "../lib/task-view";

import { QuickAdd } from "./quick-add";
import { TaskPanel } from "./task-panel";
import { TaskRow, TrashRow } from "./task-row";

import { FilterPanel } from "@/features/views/components/filter-panel";

/**
 * The shared list screen behind Inbox, Completed, Trash, and every saved view (spec
 * 9.1, 9.6, 9.7, 9.8).
 *
 * All of them are the same list with a different scope, so they are one component: a new
 * view is a route and a description, not another copy of this logic.
 *
 * Every piece of view state lives in the URL — the filters, the sort, and which task is
 * open in the side panel — so any screen a user is looking at can be shared or reloaded
 * and come back the same (spec 7.5).
 */

export interface TaskListPageProps {
  readonly scope: TaskScope;
  readonly heading: string;
  readonly subtitle: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly showQuickAdd?: boolean | undefined;
  /** Per-view defaults, which stay out of the URL until the user changes them. */
  readonly defaults?: Partial<TaskView> | undefined;
  /** The saved view this list renders, so the panel can update, rename, or delete it. */
  readonly savedView?: SavedViewDto | undefined;
  /** Extra controls under the header, such as a saved view's layout toggle. */
  readonly toolbar?: ReactNode | undefined;
}

export function TaskListPage({
  scope,
  heading,
  subtitle,
  emptyTitle,
  emptyDescription,
  showQuickAdd = false,
  defaults,
  savedView,
  toolbar,
}: TaskListPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());

  const base: TaskView = { ...DEFAULT_VIEW, ...defaults };
  const view = readTaskView(params, base);
  const openTaskKey = params.get("task");
  const filters = toListQuery(scope, view);
  const { data, isPending, isError, error, refetch } = useTaskList(filters);
  // Deferred tasks stay out of the main list and wait in a collapsed section (GAP-16).
  const deferred = useTaskList(
    { ...filters, deferred: true },
    { enabled: scope === "inbox" },
  );
  const deferredTasks = scope === "inbox" ? (deferred.data?.data ?? []) : [];

  const navigate = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      // `replace` rather than `push`: adjusting a filter should not fill the Back button
      // with intermediate states.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  function changeView(next: TaskView) {
    navigate(new URLSearchParams(writeTaskView(next, base, params)));
  }

  function hrefFor(taskKey: string): string {
    const next = new URLSearchParams(params);
    next.set("task", taskKey);
    return `${pathname}?${next.toString()}`;
  }

  const closePanel = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    navigate(next);
  }, [navigate, searchParams]);

  /**
   * Focus returns to the row that opened the panel (spec 14). It has to happen in an
   * effect rather than in the close handler: the browser resets focus to the body when
   * the focused panel unmounts, and that unmount happens after the handler returns.
   */
  const lastOpen = useRef<string | null>(openTaskKey);
  useEffect(() => {
    const previous = lastOpen.current;
    lastOpen.current = openTaskKey;
    if (previous && !openTaskKey) {
      document.getElementById(`task-link-${previous}`)?.focus();
    }
  }, [openTaskKey]);

  const tasks = data?.data ?? [];

  return (
    <div className="list-page">
      <div className="stack">
        <header className="page-header">
          <h1>{heading}</h1>
          <p className="page-header__subtitle">{subtitle}</p>
        </header>

        {showQuickAdd ? <QuickAdd /> : null}
        {toolbar}

        <FilterPanel
          scope={scope}
          view={view}
          base={base}
          onChange={changeView}
          showCompletion={scope === "inbox" || scope === "all"}
          allowSave={scope !== "trash"}
          savedView={savedView}
          resultCount={tasks.length}
        />

        {isPending ? (
          <div className="task-list__status">
            <Spinner label={`Loading ${heading}`} />
          </div>
        ) : isError ? (
          <Alert tone="error" title={`${heading} could not be loaded`}>
            <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
            <Button onClick={() => void refetch()}>Try again</Button>
          </Alert>
        ) : tasks.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <ul className="task-list" aria-label={`${heading} tasks`}>
            {tasks.map((task) =>
              scope === "trash" ? (
                <TrashRow key={task.id} task={task} />
              ) : (
                <TaskRow
                  key={task.id}
                  task={task}
                  detailHref={hrefFor(task.key)}
                  selected={task.key === openTaskKey}
                />
              ),
            )}
          </ul>
        )}

        {scope === "inbox" && deferredTasks.length > 0 ? (
          <details className="task-list__deferred">
            <summary className="task-list__deferred-summary">
              Deferred
              <span className="today-section__count">{deferredTasks.length}</span>
              <span className="task-detail__hint">Hidden until their defer date</span>
            </summary>
            <ul className="task-list" aria-label="Deferred tasks">
              {deferredTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  detailHref={hrefFor(task.key)}
                  selected={task.key === openTaskKey}
                />
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {openTaskKey ? <TaskPanel idOrKey={openTaskKey} onClose={closePanel} /> : null}
    </div>
  );
}
