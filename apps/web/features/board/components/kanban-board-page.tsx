"use client";

import { useDndMonitor, type DragEndEvent } from "@dnd-kit/core";
import type { TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
import { Alert, Button, Select, Spinner } from "@morrowlist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isMoveConflict, useMoveBoardTask, useProjectBoard } from "../hooks/use-board";
import {
  placementChangesTask,
  placementForDrop,
  readBoardStageView,
  readBoardSort,
  tasksInStatus,
  visibleBoardStatuses,
  type BoardPlacement,
  type BoardSort,
  type BoardStageView,
} from "../lib/board-view";

import { KanbanColumn } from "./kanban-column";

import { QuickAdd } from "@/features/tasks/components/quick-add";
import { TaskPanel } from "@/features/tasks/components/task-panel";

const SORT_LABELS: Record<BoardSort, string> = {
  manual: "Manual order",
  due: "Due date",
  priority: "Priority",
};

export function KanbanBoardPage({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const board = useProjectBoard(projectId);
  const moveTask = useMoveBoardTask(projectId);
  const sort = readBoardSort(new URLSearchParams(searchParams.toString()));
  const stageView = readBoardStageView(new URLSearchParams(searchParams.toString()));
  const selectedTaskKey = searchParams.get("task");
  const [mobileStatusId, setMobileStatusId] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const lastOpenTask = useRef<string | null>(selectedTaskKey);

  const closeTaskPanel = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const previous = lastOpenTask.current;
    lastOpenTask.current = selectedTaskKey;
    if (previous && !selectedTaskKey) {
      document.getElementById(`board-task-link-${previous}`)?.focus();
    }
  }, [selectedTaskKey]);

  const response = board.data;
  const statuses = useMemo(
    () => response?.data.statuses.filter((status) => status.archivedAt === null) ?? [],
    [response],
  );
  const tasks = response?.data.tasks ?? [];
  const defaultStatus = statuses.find((status) => status.isDefault) ?? statuses[0];
  const visibleStatuses = useMemo(
    () => visibleBoardStatuses(statuses, tasks, stageView),
    [stageView, statuses, tasks],
  );
  const selectedMobileStatus =
    visibleStatuses.find((status) => status.id === mobileStatusId) ??
    visibleStatuses.find((status) => status.id === defaultStatus?.id) ??
    visibleStatuses[0];
  const manuallyOrderedTasks = useMemo(
    () => statuses.flatMap((status) => tasksInStatus(tasks, status.id, "manual")),
    [statuses, tasks],
  );

  // The drag session belongs to the workspace shell (cards can also be dropped on a
  // sidebar project); the board only interprets drops on its own columns and cards.
  useDndMonitor({ onDragEnd });

  function changeSort(next: BoardSort) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "manual") params.delete("sort");
    else params.set("sort", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function changeStageView(next: BoardStageView) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "focus") params.delete("show");
    else params.set("show", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function hrefForTask(taskKey: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("task", taskKey);
    return `${pathname}?${params.toString()}`;
  }

  async function commitMove(
    task: TaskDto,
    destination: WorkflowStatusDto,
    placement: BoardPlacement,
  ) {
    moveTask.reset();
    try {
      await moveTask.mutateAsync({ task, projectId, destination, placement });
      setAnnouncement(`Moved ${task.key} to ${destination.name}.`);
    } catch {
      setAnnouncement(
        `Could not move ${task.key}. Its previous position was restored.`,
      );
    }
  }

  function moveFromMenu(task: TaskDto, statusId: string) {
    const destination = statuses.find((status) => status.id === statusId);
    if (!destination) return;
    const placement = placementForDrop(
      manuallyOrderedTasks,
      task.id,
      destination.id,
      null,
      false,
    );
    void commitMove(task, destination, placement);
  }

  function onDragEnd(event: DragEndEvent) {
    if (sort !== "manual" || !event.over) return;

    const task = tasks.find((candidate) => candidate.id === String(event.active.id));
    if (!task) return;
    const overData = event.over.data.current as
      | { type?: string; statusId?: string }
      | undefined;
    const statusId = overData?.statusId;
    const destination = statuses.find((status) => status.id === statusId);
    if (!destination) return;

    const overTaskId = overData?.type === "task" ? String(event.over.id) : null;
    const activeTop = event.active.rect.current.translated?.top;
    const insertAfter =
      activeTop !== undefined &&
      activeTop > event.over.rect.top + event.over.rect.height / 2;
    const placement = placementForDrop(
      manuallyOrderedTasks,
      task.id,
      destination.id,
      overTaskId,
      insertAfter,
    );
    if (!placementChangesTask(manuallyOrderedTasks, task, placement)) return;
    void commitMove(task, destination, placement);
  }

  if (board.isPending) {
    return (
      <div className="board-page board-page__status">
        <Spinner label="Loading project board" />
      </div>
    );
  }

  if (board.isError) {
    return (
      <div className="board-page">
        <Alert tone="error" title="This board could not be loaded">
          <p>
            {board.error instanceof Error
              ? board.error.message
              : "Something went wrong."}
          </p>
          <Button onClick={() => void board.refetch()}>Try again</Button>
        </Alert>
      </div>
    );
  }

  const project = board.data.data.project;

  return (
    <div className="board-page">
      <header className="board-page__header">
        <div>
          <p className="board-page__eyebrow">Project board</p>
          <h1>{project.name}</h1>
          <p className="board-page__summary">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} across{" "}
            {statuses.length} stages
          </p>
        </div>
        {defaultStatus ? (
          <Button variant="primary" onClick={() => setShowQuickAdd((open) => !open)}>
            {showQuickAdd ? "Close" : `+ Add to ${defaultStatus.name}`}
          </Button>
        ) : null}
      </header>

      {showQuickAdd && defaultStatus ? (
        <div className="board-page__quick-add">
          <QuickAdd
            projectId={project.id}
            statusId={defaultStatus.id}
            destinationLabel={defaultStatus.name}
          />
        </div>
      ) : null}

      <section className="board-toolbar" aria-label="Board controls">
        <strong>Board</strong>
        <details className="view-disclosure board-toolbar__view">
          <summary className="view-disclosure__summary">
            <span className="view-disclosure__summary-label">View</span>
            <span className="view-disclosure__chips">
              <span
                className="view-disclosure__chip"
                data-active={sort !== "manual" || undefined}
              >
                {SORT_LABELS[sort]}
              </span>
              <span
                className="view-disclosure__chip"
                data-active={stageView === "all" || undefined}
              >
                {stageView === "all"
                  ? "All stages"
                  : `${visibleStatuses.length} of ${statuses.length} stages`}
              </span>
            </span>
          </summary>
          <div className="view-disclosure__panel board-toolbar__view-panel">
            <label className="filters__control">
              <span className="ml-field__label">Sort by</span>
              <Select
                value={sort}
                aria-label="Sort board"
                onChange={(event) => changeSort(event.target.value as BoardSort)}
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="filters__control">
              <span className="ml-field__label">Stages</span>
              <Select
                value={stageView}
                aria-label="Stages shown"
                onChange={(event) =>
                  changeStageView(event.target.value as BoardStageView)
                }
              >
                <option value="focus">Focused stages</option>
                <option value="all">All stages</option>
              </Select>
            </label>
            <p className="board-toolbar__hint" id="board-drag-hint">
              {sort === "manual"
                ? "Drag cards or press Space on a drag handle, then use arrow keys. Drop a card on a project in the sidebar to move it there."
                : "Drag between stages is off while automatically sorted. Move menus and dragging to a sidebar project still work."}
              <br />
              Blocked and Review appear automatically when they contain work.
            </p>
          </div>
        </details>
      </section>

      {board.data.page.truncated ? (
        <Alert tone="info" title="Showing the first 500 cards">
          Narrow this board before moving work that is outside the current projection.
        </Alert>
      ) : null}

      {moveTask.isError ? (
        <Alert
          tone="error"
          title={
            isMoveConflict(moveTask.error)
              ? "This task moved somewhere else"
              : "The task could not be moved"
          }
        >
          <p>
            {isMoveConflict(moveTask.error)
              ? "Refresh the board, then choose the position again. Nothing was overwritten."
              : "Its previous position was restored. You can retry when ready."}
          </p>
          <div className="button-row">
            <Button
              onClick={() => {
                moveTask.reset();
                void board.refetch();
              }}
            >
              Refresh
            </Button>
            {moveTask.variables && !isMoveConflict(moveTask.error) ? (
              <Button
                variant="primary"
                onClick={() => {
                  const retry = moveTask.variables;
                  if (retry) moveTask.mutate(retry);
                }}
              >
                Retry
              </Button>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {statuses.length === 0 ? (
        <Alert tone="error" title="This project has no active workflow">
          At least one active status is needed before tasks can be placed on its board.
        </Alert>
      ) : (
        <div
          className="board-page__layout"
          data-panel-open={selectedTaskKey || undefined}
        >
          <div className="board-page__canvas">
            <label className="board-mobile-status">
              <span>Lane</span>
              <Select
                value={selectedMobileStatus?.id ?? ""}
                onChange={(event) => setMobileStatusId(event.target.value)}
              >
                {visibleStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name} · {tasksInStatus(tasks, status.id, sort).length}
                  </option>
                ))}
              </Select>
            </label>

            <div className="kanban-board" aria-label={`${project.name} board`}>
              {visibleStatuses.map((status) => (
                <KanbanColumn
                  key={status.id}
                  status={status}
                  tasks={tasksInStatus(tasks, status.id, sort)}
                  statuses={statuses}
                  selectedTaskKey={selectedTaskKey}
                  mobileActive={status.id === selectedMobileStatus?.id}
                  dragDisabled={moveTask.isPending}
                  reorderDisabled={sort !== "manual"}
                  moveDisabled={moveTask.isPending}
                  hrefForTask={hrefForTask}
                  onMove={moveFromMenu}
                />
              ))}
            </div>
          </div>

          {selectedTaskKey ? (
            <TaskPanel idOrKey={selectedTaskKey} onClose={closeTaskPanel} />
          ) : null}
        </div>
      )}

      <output className="ml-visually-hidden" aria-live="polite">
        {announcement}
      </output>
    </div>
  );
}
