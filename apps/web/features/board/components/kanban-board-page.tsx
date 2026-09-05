"use client";

import { useDndMonitor, type DragEndEvent } from "@dnd-kit/core";
import {
  BOARD_SWIMLANES,
  type BoardColumnDto,
  type BoardSwimlane,
  type TaskDto,
  type WipWarningDto,
  type WorkflowStatusDto,
} from "@morrowlist/contracts";
import { Alert, Button, Select, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isMoveConflict, useMoveBoardTask, useProjectBoard } from "../hooks/use-board";
import { useBoardDrop } from "../hooks/use-board-view";
import { useCollapsedColumns } from "../hooks/use-collapsed-columns";
import {
  ALL_LANE_KEY,
  SWIMLANE_LABELS,
  boardDropIntent,
  placementChangesTask,
  placementForDrop,
  readBoardCell,
  readBoardDeferred,
  readBoardStageView,
  readBoardSort,
  readBoardSubtasks,
  readBoardSwimlane,
  tasksInCell,
  tasksInColumn,
  tasksInStatus,
  visibleBoardStatuses,
  type BoardCell,
  type BoardPlacement,
  type BoardSort,
  type BoardStageView,
} from "../lib/board-view";

import { KanbanColumn, type ColumnEditing } from "./kanban-column";

import { ActivityList } from "@/features/activity/components/activity-list";
import { useProjectFlow } from "@/features/flow/hooks/use-flow";
import { readBoardAge, usuallyDoneLabel } from "@/features/flow/lib/flow-view";
import {
  describeWorkflowError,
  useArchiveStatus,
  useUpdateStatus,
} from "@/features/projects/hooks/use-workflow";
import {
  SelectionProvider,
  SelectionToolbar,
  useSelectionKeys,
} from "@/features/tasks/components/selection-toolbar";
import { QuickAdd } from "@/features/tasks/components/quick-add";
import { TaskPanel } from "@/features/tasks/components/task-panel";
import { WipWarning } from "@/features/workspace/components/wip-warning";

const SORT_LABELS: Record<BoardSort, string> = {
  manual: "Manual order",
  due: "Due date",
  priority: "Priority",
};

export function KanbanBoardPage({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const updateStatus = useUpdateStatus(projectId);
  const archiveStatus = useArchiveStatus(projectId);
  const collapsedColumns = useCollapsedColumns(projectId);
  const collapsedLanes = useCollapsedColumns(projectId, "lanes");
  const [editError, setEditError] = useState<ColumnEditing["error"]>(null);
  const sort = readBoardSort(new URLSearchParams(searchParams.toString()));
  const stageView = readBoardStageView(new URLSearchParams(searchParams.toString()));
  const showSubtasks = readBoardSubtasks(new URLSearchParams(searchParams.toString()));
  const showAge = readBoardAge(new URLSearchParams(searchParams.toString()));
  const showDeferred = readBoardDeferred(new URLSearchParams(searchParams.toString()));
  const swimlaneBy = readBoardSwimlane(new URLSearchParams(searchParams.toString()));
  const board = useProjectBoard(projectId, {
    includeSubtasks: showSubtasks,
    includeDeferred: showDeferred,
    swimlaneBy,
  });
  const flow = useProjectFlow(projectId);
  const doneHint = usuallyDoneLabel(flow.data?.cycleTimeDays.p85 ?? null);
  const moveTask = useMoveBoardTask(projectId);
  const boardDrop = useBoardDrop();
  const selectedTaskKey = searchParams.get("task");
  const [mobileStatusId, setMobileStatusId] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [wipWarning, setWipWarning] = useState<WipWarningDto | null>(null);
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
  // Multi-select order is the board read column by column, which is what a Shift-click
  // range and a select-all mean here (GAP-08).
  const selectionOrder = useMemo(
    () => manuallyOrderedTasks.map((task) => task.id),
    [manuallyOrderedTasks],
  );
  const [boardRoot, setBoardRoot] = useState<HTMLDivElement | null>(null);
  const lanes = response?.data.lanes ?? [];
  const placements = response?.data.placements ?? [];
  const swimlaned = swimlaneBy !== "none";
  const moveDisabled = moveTask.isPending || boardDrop.isPending;
  // The columns of this board expressed the way the drop rule reads them: a project
  // board's columns are its own statuses, so each one names a status id.
  const columns: BoardColumnDto[] = useMemo(
    () =>
      statuses.map((status) => ({
        key: `status:${status.id}`,
        label: status.name,
        category: status.category,
        statusId: status.id,
        isTerminal: status.isTerminal,
        wipLimit: status.wipLimit,
        colorToken: status.colorToken,
      })),
    [statuses],
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

  function changeAge(show: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (show) params.delete("age");
    else params.set("age", "off");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function changeSwimlane(next: BoardSwimlane) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "none") params.delete("swimlane");
    else params.set("swimlane", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function changeSubtasks(show: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (show) params.set("subtasks", "show");
    else params.delete("subtasks");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function changeDeferred(show: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (show) params.set("deferred", "show");
    else params.delete("deferred");
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
      const result = await moveTask.mutateAsync({
        task,
        projectId,
        destination,
        placement,
      });
      // The move went through; the limit only warns (GAP-20).
      setWipWarning(result.warnings[0] ?? null);
      setAnnouncement(
        result.warnings[0]
          ? `Moved ${task.key} to ${destination.name}. ${result.warnings[0].message}`
          : `Moved ${task.key} to ${destination.name}.`,
      );
    } catch {
      setAnnouncement(
        `Could not move ${task.key}. Its previous position was restored.`,
      );
    }
  }

  const editing: ColumnEditing = {
    busy: updateStatus.isPending || archiveStatus.isPending,
    error: editError,
    onUpdate: (status, patch) => {
      setEditError(null);
      updateStatus.mutate(
        { status, patch },
        {
          onSuccess: (next) =>
            setAnnouncement(
              patch.name !== undefined
                ? `Renamed ${status.name} to ${next.name}.`
                : `Updated ${next.name}.`,
            ),
          onError: (error) =>
            setEditError({
              statusId: status.id,
              message: describeWorkflowError(error),
            }),
        },
      );
    },
    onArchive: (status, request) => {
      setEditError(null);
      archiveStatus.mutate(
        { status, request },
        {
          onSuccess: () => setAnnouncement(`Archived ${status.name}.`),
          onError: (error) =>
            setEditError({
              statusId: status.id,
              message: describeWorkflowError(error),
            }),
        },
      );
    },
  };

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

  /** Which cell the pointer ended on: a cell itself, or the cell a card sits in. */
  function dropTarget(event: DragEndEvent): {
    cell: BoardCell;
    overTaskId: string | null;
  } | null {
    if (!event.over) return null;
    const overData = event.over.data.current as
      | { type?: string; statusId?: string | null }
      | undefined;
    const cell = readBoardCell(overData);
    if (cell) return { cell, overTaskId: null };
    if (overData?.type !== "task") return null;

    const overTaskId = String(event.over.id);
    const placement = placements.find((entry) => entry.taskId === overTaskId);
    if (!placement) return null;
    return {
      cell: {
        type: "cell",
        laneKey: placement.laneKey,
        columnKey: placement.columnKey,
        statusId: overData.statusId ?? null,
      },
      overTaskId,
    };
  }

  function onDragEnd(event: DragEndEvent) {
    const task = tasks.find((candidate) => candidate.id === String(event.active.id));
    const target = dropTarget(event);
    if (!task || !target || !event.over) return;
    const destination = statuses.find((status) => status.id === target.cell.statusId);
    if (!destination) return;

    const activeTop = event.active.rect.current.translated?.top;
    const insertAfter =
      activeTop !== undefined &&
      activeTop > event.over.rect.top + event.over.rect.height / 2;
    const placement = placementForDrop(
      manuallyOrderedTasks,
      task.id,
      destination.id,
      target.overTaskId,
      insertAfter,
    );
    const current = placements.find((entry) => entry.taskId === task.id);
    const from = {
      laneKey: current?.laneKey ?? ALL_LANE_KEY,
      columnKey: current?.columnKey ?? `status:${task.statusId ?? ""}`,
    };

    // The same-cell drop is the everyday one and keeps its optimistic path; anything
    // that crosses a lane is a real change to the card and goes through the commands
    // that own it (GAP-19).
    if (from.laneKey === target.cell.laneKey) {
      if (sort !== "manual") return;
      if (!placementChangesTask(manuallyOrderedTasks, task, placement)) return;
      void commitMove(task, destination, placement);
      return;
    }

    const intent = boardDropIntent({
      task,
      swimlaneBy,
      from,
      to: target.cell,
      lanes,
      columns,
      placement,
      reorderDisabled: sort !== "manual",
    });
    if (intent.refusal) {
      setAnnouncement(intent.refusal);
      return;
    }
    if (intent.steps.length === 0) return;

    const laneLabel =
      lanes.find((lane) => lane.key === target.cell.laneKey)?.label ?? "another lane";
    boardDrop.mutate(
      { task, steps: intent.steps },
      {
        onSuccess: (result) => {
          setWipWarning(result.warnings[0] ?? null);
          setAnnouncement(`Moved ${task.key} to ${destination.name}, ${laneLabel}.`);
        },
        onError: () =>
          setAnnouncement(
            `Could not move ${task.key}. Its previous position was restored.`,
          ),
      },
    );
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
    <SelectionProvider order={selectionOrder}>
      <BoardSelectionKeys container={boardRoot} />
      <div className="board-page" ref={setBoardRoot}>
        <SelectionToolbar tasks={tasks} statuses={statuses} projectId={project.id} />
        <header className="board-page__header">
          <div>
            <p className="board-page__eyebrow">Project board</p>
            <h1>{project.name}</h1>
            <p className="board-page__summary">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"} across{" "}
              {statuses.length} stages
              {" · "}
              <Link href={`/projects/${project.id}/flow`}>Flow</Link>
            </p>
          </div>
          <div className="board-page__actions">
            <Link
              className="ml-button ml-button--ghost"
              href={`/projects/${project.id}/settings`}
            >
              Project settings
            </Link>
            {defaultStatus ? (
              <Button
                variant="primary"
                onClick={() => setShowQuickAdd((open) => !open)}
              >
                {showQuickAdd ? "Close" : `+ Add to ${defaultStatus.name}`}
              </Button>
            ) : null}
          </div>
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
                <span
                  className="view-disclosure__chip"
                  data-active={swimlaned || undefined}
                >
                  {swimlaned ? `Lanes: ${SWIMLANE_LABELS[swimlaneBy]}` : "No swimlanes"}
                </span>
                <span
                  className="view-disclosure__chip"
                  data-active={showSubtasks || undefined}
                >
                  {showSubtasks ? "Subtasks shown" : "Subtasks hidden"}
                </span>
                <span
                  className="view-disclosure__chip"
                  data-active={!showAge || undefined}
                >
                  {showAge ? "Card age shown" : "Card age hidden"}
                </span>
                <span
                  className="view-disclosure__chip"
                  data-active={showDeferred || undefined}
                >
                  {showDeferred ? "Deferred shown" : "Deferred hidden"}
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
              <label className="filters__control">
                <span className="ml-field__label">Swimlanes</span>
                <Select
                  value={swimlaneBy}
                  aria-label="Swimlanes"
                  onChange={(event) =>
                    changeSwimlane(event.target.value as BoardSwimlane)
                  }
                >
                  {BOARD_SWIMLANES.map((value) => (
                    <option key={value} value={value}>
                      {SWIMLANE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="filters__control">
                <span className="ml-field__label">Subtasks</span>
                <Select
                  value={showSubtasks ? "show" : "hide"}
                  aria-label="Subtasks shown"
                  onChange={(event) => changeSubtasks(event.target.value === "show")}
                >
                  <option value="hide">Hidden, progress on the parent</option>
                  <option value="show">Shown as cards</option>
                </Select>
              </label>
              <label className="filters__control">
                <span className="ml-field__label">Card age</span>
                <Select
                  value={showAge ? "show" : "hide"}
                  aria-label="Card age shown"
                  onChange={(event) => changeAge(event.target.value === "show")}
                >
                  <option value="show">Days in column, fading after 7 and 14</option>
                  <option value="hide">Hidden</option>
                </Select>
              </label>
              <label className="filters__control">
                <span className="ml-field__label">Deferred</span>
                <Select
                  value={showDeferred ? "show" : "hide"}
                  aria-label="Deferred shown"
                  onChange={(event) => changeDeferred(event.target.value === "show")}
                >
                  <option value="hide">Hidden until their defer date</option>
                  <option value="show">Shown</option>
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

        {wipWarning ? (
          <WipWarning warning={wipWarning} onDismiss={() => setWipWarning(null)} />
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
            At least one active status is needed before tasks can be placed on its
            board.
          </Alert>
        ) : (
          <div
            className="board-page__layout"
            data-panel-open={selectedTaskKey || undefined}
          >
            <div className="board-page__canvas">
              <label className="board-mobile-status">
                {/* A column, not a swimlane: on a phone the board shows one stage at a time. */}
                <span>Stage</span>
                <Select
                  value={selectedMobileStatus?.id ?? ""}
                  aria-label="Board stage"
                  onChange={(event) => setMobileStatusId(event.target.value)}
                >
                  {visibleStatuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name} · {tasksInStatus(tasks, status.id, sort).length}
                    </option>
                  ))}
                </Select>
              </label>

              {swimlaned ? (
                <div className="board-swimlanes" aria-label={`${project.name} board`}>
                  {/* The columns are named once, above the lanes, so a card's column and
                    its lane each have exactly one heading. */}
                  <div className="kanban-board kanban-board--headings">
                    {visibleStatuses.map((status) => (
                      <KanbanColumn
                        key={status.id}
                        status={status}
                        tasks={tasksInColumn(tasks, placements, `status:${status.id}`)}
                        statuses={statuses}
                        bodyHidden
                        selectedTaskKey={selectedTaskKey}
                        mobileActive={status.id === selectedMobileStatus?.id}
                        dragDisabled
                        reorderDisabled
                        moveDisabled={moveDisabled}
                        collapsed={collapsedColumns.collapsed.includes(status.id)}
                        showAge={showAge}
                        hint={status.category === "in_progress" ? doneHint : null}
                        hrefForTask={hrefForTask}
                        onMove={moveFromMenu}
                        onToggleCollapse={collapsedColumns.toggle}
                        editing={editing}
                      />
                    ))}
                  </div>

                  {lanes.map((lane) => {
                    const laneCollapsed = collapsedLanes.collapsed.includes(lane.key);
                    return (
                      <section
                        key={lane.key}
                        className="board-lane"
                        data-collapsed={laneCollapsed || undefined}
                        data-writable={lane.writable || undefined}
                        aria-labelledby={`board-lane-${lane.key}`}
                      >
                        <header className="board-lane__header">
                          <button
                            type="button"
                            className="board-lane__toggle"
                            aria-expanded={!laneCollapsed}
                            aria-label={`${laneCollapsed ? "Expand" : "Collapse"} ${lane.label}`}
                            onClick={() => collapsedLanes.toggle(lane.key)}
                          >
                            <span aria-hidden="true">{laneCollapsed ? "›" : "⌄"}</span>
                          </button>
                          <h2 id={`board-lane-${lane.key}`}>{lane.label}</h2>
                          <span
                            className="board-lane__count"
                            aria-label={`${lane.count} cards`}
                          >
                            {lane.count}
                          </span>
                          {lane.writable ? null : (
                            <span className="board-lane__hint">Read-only lane</span>
                          )}
                        </header>
                        {laneCollapsed ? null : (
                          <div className="kanban-board">
                            {visibleStatuses.map((status) => (
                              <KanbanColumn
                                key={status.id}
                                status={status}
                                tasks={tasksInCell(
                                  tasks,
                                  placements,
                                  lane.key,
                                  `status:${status.id}`,
                                  sort,
                                )}
                                statuses={statuses}
                                laneKey={lane.key}
                                laneLabel={lane.label}
                                headerHidden
                                selectedTaskKey={selectedTaskKey}
                                mobileActive={status.id === selectedMobileStatus?.id}
                                dragDisabled={moveDisabled}
                                reorderDisabled={false}
                                moveDisabled={moveDisabled}
                                collapsed={collapsedColumns.collapsed.includes(
                                  status.id,
                                )}
                                showAge={showAge}
                                hint={null}
                                hrefForTask={hrefForTask}
                                onMove={moveFromMenu}
                                onToggleCollapse={collapsedColumns.toggle}
                                editing={editing}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
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
                      collapsed={collapsedColumns.collapsed.includes(status.id)}
                      showAge={showAge}
                      hint={status.category === "in_progress" ? doneHint : null}
                      hrefForTask={hrefForTask}
                      onMove={moveFromMenu}
                      onToggleCollapse={collapsedColumns.toggle}
                      editing={editing}
                    />
                  ))}
                </div>
              )}
            </div>

            {selectedTaskKey ? (
              <TaskPanel idOrKey={selectedTaskKey} onClose={closeTaskPanel} />
            ) : null}
          </div>
        )}

        <details
          className="task-detail__disclosure board-page__activity"
          onToggle={(event) => setShowActivity(event.currentTarget.open)}
        >
          <summary className="task-detail__disclosure-summary">
            <span>Project activity</span>
            <span className="task-detail__hint">
              Recent changes across this project
            </span>
          </summary>
          <div className="task-detail__disclosure-body">
            {showActivity ? (
              <ActivityList
                source={{ kind: "project", projectId: project.id }}
                label={`Activity for ${project.name}`}
              />
            ) : null}
          </div>
        </details>

        <output className="ml-visually-hidden" aria-live="polite">
          {announcement}
        </output>
      </div>
    </SelectionProvider>
  );
}

/** The `X` and `Cmd/Ctrl+A` keys, bound inside the provider the board renders. */
function BoardSelectionKeys({ container }: { readonly container: HTMLElement | null }) {
  useSelectionKeys(container);
  return null;
}
