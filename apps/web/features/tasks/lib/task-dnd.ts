import {
  closestCorners,
  pointerWithin,
  type Active,
  type CollisionDetection,
  type Over,
} from "@dnd-kit/core";
import type { TaskDto } from "@morrowlist/contracts";

/**
 * One drag-and-drop vocabulary for the whole workspace.
 *
 * The workspace shell owns a single DndContext. Board cards and list rows are draggable
 * "task" items; board columns are "status" targets handled by the board; sidebar project
 * links and the Inbox link are "destination" targets handled by the shell. A card
 * therefore drags the same way whether it is dropped on a column or on a project.
 */

export interface TaskDragData {
  readonly type: "task";
  readonly task: TaskDto;
  readonly statusId?: string | null;
}

export interface DestinationDropData {
  readonly type: "destination";
  /** Null is the Inbox. */
  readonly projectId: string | null;
  readonly name: string;
}

export function destinationDroppableId(projectId: string | null): string {
  return `destination:${projectId ?? "inbox"}`;
}

export function readDraggedTask(active: Active | null): TaskDto | null {
  const data = active?.data.current as Partial<TaskDragData> | undefined;
  return data?.type === "task" && data.task ? data.task : null;
}

export function readDestination(over: Over | null): DestinationDropData | null {
  const data = over?.data.current as Partial<DestinationDropData> | undefined;
  return data?.type === "destination" && data.projectId !== undefined && data.name
    ? { type: "destination", projectId: data.projectId, name: data.name }
    : null;
}

/**
 * A sidebar destination wins only while the pointer is actually inside it. Otherwise the
 * board target under the pointer wins, and only when the pointer is over no target at all
 * does the nearest-corners rule apply. That order matters once a board has swimlanes
 * (GAP-19): the same column exists in every lane, one directly above the other, and
 * nearest corners alone will happily resolve a drop into the lane the pointer left.
 *
 * The dragged card itself is always excluded, so a drop into an empty cell cannot resolve
 * back onto the card following the pointer. Keyboard drags have no pointer, and their
 * collision rect already sits on the chosen target, so nearest corners over every target
 * is right for them.
 */
export const taskDropCollision: CollisionDetection = (args) => {
  const isDestination = (container: { data: { current?: unknown } }) =>
    (container.data.current as Partial<DestinationDropData> | undefined)?.type ===
    "destination";
  const candidates = args.droppableContainers.filter(
    (container) => container.id !== args.active.id,
  );

  if (!args.pointerCoordinates) {
    return closestCorners({ ...args, droppableContainers: candidates });
  }

  const destinations = pointerWithin({
    ...args,
    droppableContainers: candidates.filter(isDestination),
  });
  if (destinations.length > 0) return destinations;

  const board = candidates.filter((container) => !isDestination(container));
  const under = pointerWithin({ ...args, droppableContainers: board });
  if (under.length > 0) return under;

  return closestCorners({ ...args, droppableContainers: board });
};
