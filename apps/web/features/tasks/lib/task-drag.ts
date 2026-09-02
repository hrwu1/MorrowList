import type { TaskDto } from "@morrowlist/contracts";

/**
 * Native drag payload for moving a task onto a workspace destination (a sidebar project
 * or the Inbox). Board cards and list rows write it; the sidebar reads it.
 *
 * This is deliberately the browser's own drag-and-drop rather than dnd-kit: the sidebar
 * sits outside the board's DndContext and list pages have none, so a native payload is
 * the one bridge every view can share.
 */

export const TASK_DRAG_TYPE = "application/x-morrowlist-task";

type DragData = Pick<DataTransfer, "types" | "getData" | "setData">;

export function writeTaskDrag(dataTransfer: DragData, task: TaskDto): void {
  dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify(task));
}

/** Only `types` is readable before the drop, so this is what `dragover` can check. */
export function carriesTask(dataTransfer: Pick<DataTransfer, "types">): boolean {
  return Array.from(dataTransfer.types).includes(TASK_DRAG_TYPE);
}

export function readTaskDrag(dataTransfer: DragData): TaskDto | null {
  if (!carriesTask(dataTransfer)) return null;
  try {
    const parsed: unknown = JSON.parse(dataTransfer.getData(TASK_DRAG_TYPE));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as TaskDto).id === "string" &&
      typeof (parsed as TaskDto).version === "number"
    ) {
      return parsed as TaskDto;
    }
  } catch {
    // A malformed payload is treated as "not a task", never as a crash mid-drop.
  }
  return null;
}
