import { fixedClock } from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import { SearchService } from "../search/service.js";
import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
} from "../testing/index.js";

import { WorkspaceService } from "./service.js";

const NOW = new Date("2026-09-07T09:00:00.000Z");
const SECRET = "rename-check";

describe("renaming a task key prefix", () => {
  it("re-renders every key and leaves no stale one behind", async () => {
    const unitOfWork = createInMemoryUnitOfWork(emptyData());
    const seeded = seedWorkspace(unitOfWork.data);
    const clock = fixedClock(NOW);
    const tasks = new TaskService({ unitOfWork, clock, cursorSecret: SECRET });
    const search = new SearchService({ unitOfWork, clock, cursorSecret: SECRET });
    const workspaces = new WorkspaceService({ unitOfWork, clock });

    const first = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Before the rename",
    });
    expect(first.key).toBe("ML-000001");

    const workspace = await workspaces.update(seeded.context, seeded.workspace.id, {
      taskKeyPrefix: "MorrowList",
      expectedVersion: seeded.workspace.version,
    });
    expect(workspace.taskKeyPrefix).toBe("MorrowList");

    // Every rendered key follows the rename.
    const after = await tasks.get(seeded.context, seeded.workspace.id, first.id);
    expect(after.key).toBe("MorrowList-000001");

    // A task created after the rename numbers on from the same counter.
    const second = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "After the rename",
    });
    expect(second.key).toBe("MorrowList-000002");

    // The key shared before the rename still finds its task.
    const stale = await search.search(seeded.context, {
      workspaceId: seeded.workspace.id,
      q: "ML-000001",
      limit: 50,
      includeSubtasks: true,
    } as never);
    expect(stale.data.tasks[0]?.task.id).toBe(first.id);

    // Nothing stored in activity still carries the old prefix.
    const history = unitOfWork.data.activity.map((entry) => entry.summary);
    expect(history.filter((line) => line.includes("ML-"))).toEqual([]);
  });
});
