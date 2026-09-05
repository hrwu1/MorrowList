"use client";

import type { SavedViewDto, TaskDto } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
import {
  SelectionProvider,
  SelectionToolbar,
  useSelectionKeys,
} from "./selection-toolbar";
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
  // Deferred tasks stay out of the main list and wait in a collapsed section (GAP-16),
  // unless the panel asked for a deferral state explicitly.
  const showDeferredSection = scope === "inbox" && view.deferred === "any";
  const deferred = useTaskList(
    { ...filters, deferred: true },
    { enabled: showDeferredSection },
  );
  const deferredTasks = showDeferredSection ? (deferred.data?.data ?? []) : [];

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
  // Both sections are one selection: a range that starts in the list and ends in the
  // deferred section is still one continuous run of rows on screen. Memoised on the joined
  // ids rather than the arrays, so a refetch that changes nothing does not reset it.
  const orderKey = [...tasks, ...deferredTasks].map((task) => task.id).join(",");
  const order = useMemo(() => (orderKey === "" ? [] : orderKey.split(",")), [orderKey]);

  return (
    <SelectionProvider order={scope === "trash" ? [] : order}>
      <TaskListBody
        scope={scope}
        heading={heading}
        subtitle={subtitle}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        showQuickAdd={showQuickAdd}
        savedView={savedView}
        toolbar={toolbar}
        view={view}
        base={base}
        openTaskKey={openTaskKey}
        tasks={tasks}
        deferredTasks={deferredTasks}
        showDeferredSection={showDeferredSection}
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        onChangeView={changeView}
        hrefFor={hrefFor}
        onClosePanel={closePanel}
      />
    </SelectionProvider>
  );
}

/**
 * The list itself. Split from the page only so it renders inside the selection provider
 * and can therefore use the selection: the toolbar, the checkboxes on the rows, and the
 * `X` and `Cmd/Ctrl+A` keys all read the same state.
 */
function TaskListBody({
  scope,
  heading,
  subtitle,
  emptyTitle,
  emptyDescription,
  showQuickAdd,
  savedView,
  toolbar,
  view,
  base,
  openTaskKey,
  tasks,
  deferredTasks,
  showDeferredSection,
  isPending,
  isError,
  error,
  onRetry,
  onChangeView,
  hrefFor,
  onClosePanel,
}: {
  readonly scope: TaskScope;
  readonly heading: string;
  readonly subtitle: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly showQuickAdd: boolean;
  readonly savedView: SavedViewDto | undefined;
  readonly toolbar: ReactNode | undefined;
  readonly view: TaskView;
  readonly base: TaskView;
  readonly openTaskKey: string | null;
  readonly tasks: readonly TaskDto[];
  readonly deferredTasks: readonly TaskDto[];
  readonly showDeferredSection: boolean;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly onChangeView: (next: TaskView) => void;
  readonly hrefFor: (taskKey: string) => string;
  readonly onClosePanel: () => void;
}) {
  const [listRoot, setListRoot] = useState<HTMLDivElement | null>(null);
  useSelectionKeys(listRoot);

  return (
    <div className="list-page" ref={setListRoot}>
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
          onChange={onChangeView}
          showCompletion={scope === "inbox" || scope === "all"}
          allowSave={scope !== "trash"}
          savedView={savedView}
          resultCount={tasks.length}
        />

        {/* Under the filters, where the selection it acts on begins (GAP-02, GAP-08). */}
        <SelectionToolbar tasks={[...tasks, ...deferredTasks]} />

        {isPending ? (
          <div className="task-list__status">
            <Spinner label={`Loading ${heading}`} />
          </div>
        ) : isError ? (
          <Alert tone="error" title={`${heading} could not be loaded`}>
            <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
            <Button onClick={onRetry}>Try again</Button>
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

        {showDeferredSection && deferredTasks.length > 0 ? (
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

      {openTaskKey ? <TaskPanel idOrKey={openTaskKey} onClose={onClosePanel} /> : null}
    </div>
  );
}
