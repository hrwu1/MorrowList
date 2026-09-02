"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";

import { KanbanCard } from "./kanban-card";

export interface KanbanColumnProps {
  readonly status: WorkflowStatusDto;
  readonly tasks: readonly TaskDto[];
  readonly statuses: readonly WorkflowStatusDto[];
  readonly selectedTaskKey: string | null;
  readonly mobileActive: boolean;
  /** No card may start a drag (a move is in flight). */
  readonly dragDisabled: boolean;
  /** Columns accept no drops (automatic sort); cards can still be dragged to the sidebar. */
  readonly reorderDisabled: boolean;
  readonly moveDisabled: boolean;
  readonly hrefForTask: (taskKey: string) => string;
  readonly onMove: (task: TaskDto, statusId: string) => void;
}

export function KanbanColumn({
  status,
  tasks,
  statuses,
  selectedTaskKey,
  mobileActive,
  dragDisabled,
  reorderDisabled,
  moveDisabled,
  hrefForTask,
  onMove,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `status:${status.id}`,
    disabled: reorderDisabled,
    data: { type: "status", statusId: status.id },
  });
  const overLimit = status.wipLimit !== null && tasks.length > status.wipLimit;
  const atLimit = status.wipLimit !== null && tasks.length === status.wipLimit;
  const exceptionStage = status.category === "blocked" || status.category === "review";

  return (
    <section
      ref={setNodeRef}
      className="kanban-column"
      data-category={status.category}
      data-core-stage={!exceptionStage || undefined}
      data-exception-stage={exceptionStage || undefined}
      data-revealed={exceptionStage || undefined}
      data-occupied={tasks.length > 0 || undefined}
      data-drop-target={isOver || undefined}
      data-wip-over={overLimit || undefined}
      data-mobile-active={mobileActive || undefined}
      aria-labelledby={`board-status-${status.id}`}
    >
      <header className="kanban-column__header">
        <div className="kanban-column__heading">
          <span className="kanban-column__dot" aria-hidden="true" />
          <h2 id={`board-status-${status.id}`}>{status.name}</h2>
          <span className="kanban-column__count" aria-label={`${tasks.length} tasks`}>
            {tasks.length}
          </span>
        </div>
        {status.wipLimit !== null ? (
          <span
            className="kanban-column__wip"
            data-state={overLimit ? "over" : atLimit ? "at" : undefined}
          >
            {tasks.length} / {status.wipLimit} WIP
            {overLimit ? " · over limit" : atLimit ? " · at limit" : ""}
          </span>
        ) : null}
      </header>

      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="kanban-column__tasks" aria-label={`${status.name} tasks`}>
          {tasks.length === 0 ? (
            <li className="kanban-column__empty">Drop a task here</li>
          ) : (
            tasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                statuses={statuses}
                detailHref={hrefForTask(task.key)}
                selected={task.key === selectedTaskKey}
                dragDisabled={dragDisabled}
                reorderDisabled={reorderDisabled}
                moveDisabled={moveDisabled}
                onMove={onMove}
              />
            ))
          )}
        </ul>
      </SortableContext>
    </section>
  );
}
