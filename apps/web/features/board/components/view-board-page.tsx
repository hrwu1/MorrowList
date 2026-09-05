"use client";

import { useDndMonitor, type DragEndEvent } from "@dnd-kit/core";
import {
  BOARD_SWIMLANES,
  type BoardSwimlane,
  type BoardViewQuery,
  type TaskDto,
  type WipWarningDto,
} from "@morrowlist/contracts";
import { Alert, Button, Select, Spinner } from "@morrowlist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useBoardDrop, useBoardView } from "../hooks/use-board-view";
import { useCollapsedColumns } from "../hooks/use-collapsed-columns";
import {
  ALL_LANE_KEY,
  SWIMLANE_LABELS,
  boardDropIntent,
  placementForDrop,
  readBoardCell,
  readBoardSwimlane,
  tasksInCell,
  type BoardCell,
} from "../lib/board-view";

import { ViewBoardColumn } from "./view-board-column";

import { TaskPanel } from "@/features/tasks/components/task-panel";
import { WipWarning } from "@/features/workspace/components/wip-warning";

export interface ViewBoardPageProps {
  /** The filters this board projects; Today supplies `source: "today"` instead. */
  readonly filters: Omit<Partial<BoardViewQuery>, "swimlaneBy">;
  /** Distinguishes one board's collapsed lanes from another's in local storage. */
  readonly scope: string;
  readonly heading: string;
  readonly emptyMessage: string;
}

/**
 * A saved view or Today drawn as a board across projects (spec 9.5, GAP-19).
 *
 * Every card keeps its own project's workflow: the columns are the semantic categories
 * projects share, and dropping a card into one asks the server to resolve that category
 * inside the card's own project (spec 11.5). The lanes and each card's cell come from the
 * response, so nothing here decides where a card belongs.
 */
export function ViewBoardPage({
  filters,
  scope,
  heading,
  emptyMessage,
}: ViewBoardPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const swimlaneBy = readBoardSwimlane(new URLSearchParams(searchParams.toString()));
  const query = useMemo(
    () => ({ ...filters, columnsBy: "category" as const, swimlaneBy }),
    [filters, swimlaneBy],
  );
  const board = useBoardView(query);
  const drop = useBoardDrop();
  const collapsedLanes = useCollapsedColumns(scope, "view-lanes");
  const selectedTaskKey = searchParams.get("task");
  const [announcement, setAnnouncement] = useState("");
  const [wipWarning, setWipWarning] = useState<WipWarningDto | null>(null);
  const [mobileColumnKey, setMobileColumnKey] = useState<string | null>(null);

  const data = board.data?.data;
  const tasks = data?.tasks ?? [];
  const placements = data?.placements ?? [];
  const columns = data?.columns ?? [];
  const lanes = data?.lanes ?? [];
  const moveOptions = columns.map((column) => ({
    value: column.key,
    label: column.label,
  }));
  const activeColumn =
    columns.find((column) => column.key === mobileColumnKey) ?? columns[0];

  useDndMonitor({ onDragEnd });

  function changeSwimlane(next: BoardSwimlane) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "none") params.delete("swimlane");
    else params.set("swimlane", next);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function hrefForTask(taskKey: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("task", taskKey);
    return `${pathname}?${params.toString()}`;
  }

  function closeTaskPanel() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function applyDrop(task: TaskDto, cell: BoardCell, overTaskId: string | null) {
    const current = placements.find((entry) => entry.taskId === task.id);
    const from = {
      laneKey: current?.laneKey ?? ALL_LANE_KEY,
      columnKey: current?.columnKey ?? "",
    };
    const column = columns.find((candidate) => candidate.key === cell.columnKey);
    const intent = boardDropIntent({
      task,
      swimlaneBy,
      from,
      to: cell,
      lanes,
      columns,
      // Ranks are scoped to a project status (ADR-009), so a board spanning projects
      // never rewrites them: a card lands at the end of its destination scope.
      placement: placementForDrop([], task.id, task.statusId ?? "", overTaskId, false),
      reorderDisabled: true,
    });
    if (intent.refusal) {
      setAnnouncement(intent.refusal);
      return;
    }
    if (intent.steps.length === 0) return;

    drop.mutate(
      { task, steps: intent.steps },
      {
        onSuccess: (result) => {
          setWipWarning(result.warnings[0] ?? null);
          setAnnouncement(`Moved ${task.key} to ${column?.label ?? "another column"}.`);
        },
        onError: () =>
          setAnnouncement(
            `Could not move ${task.key}. Its previous position was restored.`,
          ),
      },
    );
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const task = tasks.find((candidate) => candidate.id === String(event.active.id));
    if (!task) return;
    const overData = event.over.data.current as
      | { type?: string; statusId?: string | null }
      | undefined;

    const cell = readBoardCell(overData);
    if (cell) {
      applyDrop(task, cell, null);
      return;
    }
    if (overData?.type !== "task") return;
    const overTaskId = String(event.over.id);
    const placement = placements.find((entry) => entry.taskId === overTaskId);
    if (!placement) return;
    applyDrop(
      task,
      {
        type: "cell",
        laneKey: placement.laneKey,
        columnKey: placement.columnKey,
        statusId: overData.statusId ?? null,
      },
      overTaskId,
    );
  }

  function moveFromMenu(task: TaskDto, columnKey: string) {
    const current = placements.find((entry) => entry.taskId === task.id);
    applyDrop(
      task,
      {
        type: "cell",
        laneKey: current?.laneKey ?? ALL_LANE_KEY,
        columnKey,
        statusId: null,
      },
      null,
    );
  }

  if (board.isPending) {
    return (
      <div className="board-page board-page__status">
        <Spinner label={`Loading ${heading}`} />
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

  return (
    <div className="board-page">
      <section className="board-toolbar" aria-label="Board controls">
        <strong>Board</strong>
        <label className="filters__control">
          <span className="ml-field__label">Swimlanes</span>
          <Select
            value={swimlaneBy}
            aria-label="Swimlanes"
            onChange={(event) => changeSwimlane(event.target.value as BoardSwimlane)}
          >
            {BOARD_SWIMLANES.map((value) => (
              <option key={value} value={value}>
                {SWIMLANE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        <p className="board-toolbar__hint">
          Columns are the stages every project shares, so a card dropped in one lands in
          its own project&rsquo;s matching status.
        </p>
      </section>

      {board.data.page.truncated ? (
        <Alert tone="info" title="Showing the first 500 cards">
          Narrow this view before moving work that is outside the current projection.
        </Alert>
      ) : null}

      {wipWarning ? (
        <WipWarning warning={wipWarning} onDismiss={() => setWipWarning(null)} />
      ) : null}

      {tasks.length === 0 ? (
        <Alert tone="info" title="Nothing on this board">
          {emptyMessage}
        </Alert>
      ) : (
        <div
          className="board-page__layout"
          data-panel-open={selectedTaskKey || undefined}
        >
          <div className="board-page__canvas">
            <label className="board-mobile-status">
              <span>Stage</span>
              <Select
                value={activeColumn?.key ?? ""}
                aria-label="Board stage"
                onChange={(event) => setMobileColumnKey(event.target.value)}
              >
                {columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </Select>
            </label>

            <div className="board-swimlanes" aria-label={`${heading} board`}>
              <div className="kanban-board kanban-board--headings">
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className="kanban-column kanban-column--label"
                    data-category={column.category}
                    data-mobile-active={
                      column.key === activeColumn?.key || undefined
                    }
                  >
                    <header className="kanban-column__header">
                      <div className="kanban-column__heading">
                        <span className="kanban-column__dot" aria-hidden="true" />
                        <h2 id={`board-column-${column.key}`}>{column.label}</h2>
                        <span className="kanban-column__count">
                          {
                            placements.filter(
                              (entry) => entry.columnKey === column.key,
                            ).length
                          }
                        </span>
                      </div>
                    </header>
                  </div>
                ))}
              </div>

              {lanes.map((lane) => {
                const collapsed = collapsedLanes.collapsed.includes(lane.key);
                return (
                  <section
                    key={lane.key}
                    className="board-lane"
                    data-collapsed={collapsed || undefined}
                    aria-labelledby={`board-lane-${lane.key}`}
                  >
                    {swimlaneBy === "none" ? null : (
                      <header className="board-lane__header">
                        <button
                          type="button"
                          className="board-lane__toggle"
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? "Expand" : "Collapse"} ${lane.label}`}
                          onClick={() => collapsedLanes.toggle(lane.key)}
                        >
                          <span aria-hidden="true">{collapsed ? "›" : "⌄"}</span>
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
                    )}
                    {collapsed ? null : (
                      <div className="kanban-board">
                        {columns.map((column) => (
                          <ViewBoardColumn
                            key={column.key}
                            column={column}
                            laneKey={lane.key}
                            laneLabel={swimlaneBy === "none" ? null : lane.label}
                            tasks={tasksInCell(
                              tasks,
                              placements,
                              lane.key,
                              column.key,
                              "manual",
                            )}
                            moveOptions={moveOptions}
                            selectedTaskKey={selectedTaskKey}
                            mobileActive={column.key === activeColumn?.key}
                            busy={drop.isPending}
                            hrefForTask={hrefForTask}
                            onMove={moveFromMenu}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
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
