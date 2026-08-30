"use client";

import { useSortable } from "@dnd-kit/sortable";
import type { TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
import Link from "next/link";
import type { CSSProperties } from "react";

import { DueBadge, PriorityBadge } from "@/features/tasks/components/task-fields";

export interface KanbanCardProps {
  readonly task: TaskDto;
  readonly statuses: readonly WorkflowStatusDto[];
  readonly detailHref: string;
  readonly selected: boolean;
  readonly dragDisabled: boolean;
  readonly moveDisabled: boolean;
  readonly onMove: (task: TaskDto, statusId: string) => void;
}

export function KanbanCard({
  task,
  statuses,
  detailHref,
  selected,
  dragDisabled,
  moveDisabled,
  onMove,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      disabled: dragDisabled,
      data: { type: "task", taskId: task.id, statusId: task.statusId },
    });
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="board-card"
      data-dragging={isDragging || undefined}
      data-done={task.isCompleted || undefined}
      aria-current={selected ? "true" : undefined}
    >
      <div className="board-card__controls">
        <label>
          <span className="ml-visually-hidden">Move {task.title}</span>
          <select
            className="board-card__move"
            value=""
            disabled={moveDisabled}
            aria-label={`Move ${task.title}`}
            onChange={(event) => {
              if (event.target.value) onMove(task, event.target.value);
            }}
          >
            <option value="">Move…</option>
            {statuses.map((status) => (
              <option
                key={status.id}
                value={status.id}
                disabled={status.id === task.statusId}
              >
                {status.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="board-card__drag"
          disabled={dragDisabled}
          aria-label={
            dragDisabled
              ? `Drag ${task.title} unavailable while automatically sorted`
              : `Drag ${task.title}. Press Space, then use arrow keys to move it.`
          }
          {...attributes}
          {...listeners}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </div>

      <Link
        className="board-card__title"
        href={detailHref}
        id={`board-task-link-${task.key}`}
      >
        {task.title}
      </Link>

      <div className="board-card__meta">
        <span className="task-row__key">{task.key}</span>
        <PriorityBadge priority={task.priority} />
        <DueBadge
          dueDate={task.dueDate}
          dueTime={task.dueTime}
          isCompleted={task.isCompleted}
        />
      </div>
    </li>
  );
}
