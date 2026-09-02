import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { TASK_DRAG_TYPE, carriesTask, readTaskDrag, writeTaskDrag } from "./task-drag";

function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    get types() {
      return Array.from(store.keys());
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  };
}

const task = {
  id: "0198f0a0-0000-7000-8000-000000000001",
  key: "T-1",
  title: "Draft brief",
  version: 3,
  projectId: null,
} as TaskDto;

describe("task drag payload", () => {
  it("round-trips a task through the transfer", () => {
    const transfer = fakeDataTransfer();
    writeTaskDrag(transfer, task);
    expect(carriesTask(transfer)).toBe(true);
    expect(readTaskDrag(transfer)).toEqual(task);
  });

  it("ignores transfers that carry something else", () => {
    const transfer = fakeDataTransfer();
    transfer.setData("text/plain", "not a task");
    expect(carriesTask(transfer)).toBe(false);
    expect(readTaskDrag(transfer)).toBeNull();
  });

  it("treats a malformed payload as no task", () => {
    const transfer = fakeDataTransfer();
    transfer.setData(TASK_DRAG_TYPE, "{not json");
    expect(readTaskDrag(transfer)).toBeNull();
    transfer.setData(TASK_DRAG_TYPE, JSON.stringify({ title: "no id" }));
    expect(readTaskDrag(transfer)).toBeNull();
  });
});
