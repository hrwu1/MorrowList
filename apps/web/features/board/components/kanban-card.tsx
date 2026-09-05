"use client";

import { useSortable } from "@dnd-kit/sortable";
import type { TaskDto } from "@morrowlist/contracts";
import Link from "next/link";
import type { CSSProperties, KeyboardEventHandler } from "react";

import { ageBand, daysInStatus } from "@/features/flow/lib/flow-view";
import { BlockedBadge } from "@/features/relations/components/blocked-badge";
import { TagChips } from "@/features/tags/components/tag-chip";
import { SelectionCheckbox } from "@/features/tasks/components/selection-toolbar";
import {
  DeadlineBadge,
  DeferBadge,
  DueBadge,
  MyDayBadge,
  PriorityBadge,
  RepeatBadge,
  SubtaskProgressBadge,
} from "@/features/tasks/components/task-fields";
import { useAddToDay, useRemoveFromDay } from "@/features/tasks/hooks/use-tasks";
import type { TaskDragData } from "@/features/tasks/lib/task-dnd";

/**
 * The non-drag way to move a card (spec 9.5). A project board offers its statuses; a
 * board spanning projects offers the shared categories, so the same card serves both.
 */
export interface BoardMoveOption {
  readonly value: string;
  readonly label: string;
}

export interface KanbanCardProps {
  readonly task: TaskDto;
  readonly moveOptions: readonly BoardMoveOption[];
  /** The option the card already sits in, which the menu offers but disables. */
  readonly currentMoveValue: string | null;
  readonly detailHref: string;
  readonly selected: boolean;
  readonly dragDisabled: boolean;
  readonly reorderDisabled: boolean;
  readonly moveDisabled: boolean;
  /** Show how long the card has sat in its column and fade the oldest (GAP-17). */
  readonly showAge: boolean;
  readonly onMove: (task: TaskDto, value: string) => void;
}

export function KanbanCard({
  task,
  moveOptions,
  currentMoveValue,
  detailHref,
  selected,
  dragDisabled,
  reorderDisabled,
  moveDisabled,
  showAge,
  onMove,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      disabled: { draggable: dragDisabled, droppable: reorderDisabled },
      data: { type: "task", task, statusId: task.statusId } satisfies TaskDragData,
    });
  const addToDay = useAddToDay();
  const removeFromDay = useRemoveFromDay();
  const inMyDay = task.dayPlans.length > 0;
  // Age is read from the browser clock so it stays current while the board is open.
  const days =
    showAge && !task.isCompleted ? daysInStatus(task.inStatusSince, Date.now()) : null;
  const band = ageBand(days);
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
      // The `X` key needs to know which card the focus is inside (GAP-08).
      data-task-id={task.id}
      data-blocked={task.isBlocked || undefined}
      data-dragging={isDragging || undefined}
      data-done={task.isCompleted || undefined}
      data-age={band ?? undefined}
      aria-current={selected ? "true" : undefined}
      // The whole card is the pointer drag source; the handle is the keyboard one. The
      // Move menu opens on press, so it never starts a drag.
      onPointerDown={(event) => {
        if (
          (event.target as HTMLElement).closest("select, input, .board-card__my-day")
        ) {
          return;
        }
        listeners?.onPointerDown?.(event);
      }}
    >
      <div className="board-card__controls">
        <SelectionCheckbox task={task} />
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
            {moveOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value === currentMoveValue}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="board-card__my-day"
          aria-pressed={inMyDay}
          aria-label={
            inMyDay ? `Remove ${task.title} from My Day` : `Add ${task.title} to My Day`
          }
          title={inMyDay ? "Remove from My Day" : "Add to My Day"}
          disabled={task.isCompleted || addToDay.isPending || removeFromDay.isPending}
          onClick={() => (inMyDay ? removeFromDay.mutate(task) : addToDay.mutate(task))}
        >
          <span aria-hidden="true">☀</span>
        </button>
        <button
          type="button"
          className="board-card__drag"
          disabled={dragDisabled}
          aria-label={
            dragDisabled
              ? `Drag ${task.title} unavailable while a move is saving`
              : `Drag ${task.title}. Press Space, then use arrow keys to move it.`
          }
          {...attributes}
          onKeyDown={
            listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined
          }
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
        <RepeatBadge recurrence={task.recurrence} />
        <DeadlineBadge
          deadline={task.deadline}
          deadlineTime={task.deadlineTime}
          isCompleted={task.isCompleted}
        />
        <DeferBadge deferUntil={task.deferUntil} />
        <MyDayBadge dayPlans={task.dayPlans} />
        <BlockedBadge task={task} />
        <SubtaskProgressBadge progress={task.subtaskProgress} />
        {days !== null && days >= 1 ? (
          <span
            className="board-card__age"
            data-age={band ?? undefined}
            title={`In this column for ${days} ${days === 1 ? "day" : "days"}`}
            aria-label={`In this column for ${days} ${days === 1 ? "day" : "days"}`}
          >
            {days}d
          </span>
        ) : null}
      </div>

      {task.tags.length > 0 ? (
        <div className="board-card__tags">
          <TagChips tags={task.tags} />
        </div>
      ) : null}
    </li>
  );
}
