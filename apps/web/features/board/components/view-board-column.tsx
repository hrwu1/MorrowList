"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { BoardColumnDto, TaskDto } from "@morrowlist/contracts";

import { cellDroppableId, type BoardCell } from "../lib/board-view";

import { KanbanCard, type BoardMoveOption } from "./kanban-card";

export interface ViewBoardColumnProps {
  readonly column: BoardColumnDto;
  readonly laneKey: string;
  readonly laneLabel: string | null;
  readonly tasks: readonly TaskDto[];
  readonly moveOptions: readonly BoardMoveOption[];
  readonly selectedTaskKey: string | null;
  readonly mobileActive: boolean;
  readonly busy: boolean;
  readonly hrefForTask: (taskKey: string) => string;
  readonly onMove: (task: TaskDto, columnKey: string) => void;
}

/**
 * One cell of the board that spans projects (GAP-19). Deliberately plainer than
 * `KanbanColumn`: a category column belongs to no project, so it has no name to rename,
 * no WIP limit to set and no policy to edit — those stay on the project's own board.
 */
export function ViewBoardColumn({
  column,
  laneKey,
  laneLabel,
  tasks,
  moveOptions,
  selectedTaskKey,
  mobileActive,
  busy,
  hrefForTask,
  onMove,
}: ViewBoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: cellDroppableId(laneKey, column.key),
    data: {
      type: "cell",
      laneKey,
      columnKey: column.key,
      statusId: column.statusId,
    } satisfies BoardCell,
  });

  return (
    <section
      ref={setNodeRef}
      className="kanban-column"
      data-category={column.category}
      data-color={column.colorToken}
      data-cell
      data-occupied={tasks.length > 0 || undefined}
      data-drop-target={isOver || undefined}
      data-mobile-active={mobileActive || undefined}
      aria-labelledby={`board-column-${column.key}`}
    >
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          className="kanban-column__tasks"
          aria-label={
            laneLabel ? `${laneLabel}, ${column.label} tasks` : `${column.label} tasks`
          }
        >
          {tasks.length === 0 ? (
            <li className="kanban-column__empty">Drop a task here</li>
          ) : (
            tasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                moveOptions={moveOptions}
                currentMoveValue={column.key}
                detailHref={hrefForTask(task.key)}
                selected={task.key === selectedTaskKey}
                dragDisabled={busy}
                reorderDisabled={false}
                moveDisabled={busy}
                showAge={false}
                onMove={onMove}
              />
            ))
          )}
        </ul>
      </SortableContext>
    </section>
  );
}
