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
 * A sidebar destination wins only while the pointer is actually inside it; otherwise the
 * board's nearest-corners rule applies, excluding the dragged card itself so drops into an
 * empty column do not resolve back onto the card following the pointer. Keyboard drags
 * have no pointer, and their collision rect already sits on the chosen target, so nearest
 * corners over every target is right for them.
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

  return closestCorners({
    ...args,
    droppableContainers: candidates.filter((container) => !isDestination(container)),
  });
};
