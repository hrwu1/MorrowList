import type { Active, DroppableContainer, Over } from "@dnd-kit/core";
import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  destinationDroppableId,
  readDestination,
  readDraggedTask,
  taskDropCollision,
} from "./task-dnd";

const task = { id: "task-1", title: "Draft brief", version: 2 } as TaskDto;

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function container(
  id: string,
  data: Record<string, unknown>,
  box: ReturnType<typeof rect>,
): DroppableContainer {
  return {
    id,
    key: id,
    disabled: false,
    node: { current: null },
    rect: { current: box },
    data: { current: data },
  } as unknown as DroppableContainer;
}

const active = {
  id: "task-1",
  data: { current: { type: "task", task } },
} as unknown as Active;
const column = container(
  "status:ready",
  { type: "status", statusId: "ready" },
  rect(300, 0, 200, 600),
);
const project = container(
  destinationDroppableId("p1"),
  { type: "destination", projectId: "p1", name: "Design" },
  rect(0, 100, 200, 40),
);
const self = container("task-1", { type: "task", task }, rect(310, 10, 180, 60));

function collide(pointer: { x: number; y: number } | null) {
  return taskDropCollision({
    active,
    collisionRect: pointer
      ? { ...rect(pointer.x - 10, pointer.y - 10, 20, 20) }
      : { ...rect(0, 100, 200, 40) },
    // dnd-kit's algorithms read rects from this map, not from the containers.
    droppableRects: new Map(
      [column, project, self].map((item) => [item.id, item.rect.current!]),
    ),
    droppableContainers: [column, project, self],
    pointerCoordinates: pointer,
  }).map((collision) => collision.id);
}

describe("task drag data", () => {
  it("reads a task off the active item and a destination off the target", () => {
    expect(readDraggedTask(active)).toBe(task);
    expect(
      readDraggedTask({
        id: "x",
        data: { current: { type: "status" } },
      } as unknown as Active),
    ).toBeNull();
    expect(
      readDestination({
        id: destinationDroppableId(null),
        data: { current: { type: "destination", projectId: null, name: "Inbox" } },
      } as unknown as Over),
    ).toEqual({ type: "destination", projectId: null, name: "Inbox" });
    expect(readDestination(null)).toBeNull();
  });
});

describe("taskDropCollision", () => {
  it("prefers a destination the pointer is inside", () => {
    expect(collide({ x: 50, y: 120 })).toEqual([destinationDroppableId("p1")]);
  });

  it("falls back to the nearest board target, never the dragged card itself", () => {
    const hits = collide({ x: 400, y: 300 });
    expect(hits[0]).toBe("status:ready");
    expect(hits).not.toContain("task-1");
    expect(hits).not.toContain(destinationDroppableId("p1"));
  });

  it("considers every target for a keyboard drag", () => {
    expect(collide(null)[0]).toBe(destinationDroppableId("p1"));
  });
});
