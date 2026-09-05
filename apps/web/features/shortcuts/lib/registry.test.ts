import type { TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildCommands, nextDay, type ShortcutDeps } from "./commands";
import {
  COMMAND_GROUPS,
  activeScopes,
  adjacentStatus,
  chordIsEnabled,
  findConflicts,
  findDuplicateKeysWithinCommands,
  isAvailable,
  isPendingPrefix,
  resolveCommand,
  surfaceOf,
  type Command,
  type ShortcutContext,
} from "./registry";

/**
 * These run against the real command table, not a fixture, so a new binding that clashes
 * with an existing one fails here rather than on somebody's keyboard.
 */

const ENABLED = { singleKeyEnabled: true } as const;
const DISABLED = { singleKeyEnabled: false } as const;

function deps(overrides: Partial<ShortcutDeps> = {}): ShortcutDeps {
  return {
    navigate: vi.fn(),
    announce: vi.fn(),
    openSearch: vi.fn(),
    openCapture: vi.fn(),
    openPalette: vi.fn(),
    openCheatSheet: vi.fn(),
    canUndo: () => true,
    undo: vi.fn(),
    currentTask: async () => null,
    today: () => "2026-09-05",
    actions: {
      complete: async () => undefined,
      reopen: async () => undefined,
      setPriority: async () => undefined,
      setDueDate: async () => undefined,
      addToDay: async () => undefined,
      removeFromDay: async () => undefined,
      remove: async () => undefined,
      moveByOneColumn: async () => null,
      openDetail: () => undefined,
    },
    ...overrides,
  };
}

const commands = buildCommands(deps());

function on(surface: ShortcutContext["surface"], hasTask = false): ShortcutContext {
  return { surface, hasTask };
}

function status(overrides: Partial<WorkflowStatusDto> = {}): WorkflowStatusDto {
  return {
    id: "s1",
    projectId: "p1",
    name: "Ready",
    category: "ready",
    rank: "aa",
    colorToken: "neutral",
    wipLimit: null,
    isDefault: true,
    isTerminal: false,
    policyMd: null,
    archivedAt: null,
    version: 1,
    ...overrides,
  };
}

describe("the command table", () => {
  it("has no two bindings that could fire at the same moment", () => {
    expect(findConflicts(commands)).toEqual([]);
  });

  it("never lists the same chord twice on one command", () => {
    expect(findDuplicateKeysWithinCommands(commands)).toEqual([]);
  });

  it("gives every command a unique id, a title and at least one key", () => {
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) {
      expect(command.title.length).toBeGreaterThan(0);
      expect(command.keys.length).toBeGreaterThan(0);
    }
  });

  it("puts every command in a group the cheat sheet renders", () => {
    for (const command of commands) {
      expect(COMMAND_GROUPS).toContain(command.group);
    }
  });

  it("catches a clash that a careless addition would introduce", () => {
    const clashing: Command[] = [
      ...commands,
      {
        id: "test.clash",
        title: "Something else entirely",
        keys: ["e"],
        scope: "board",
        group: "Task",
        run: () => undefined,
      },
    ];
    // `e` completes the focused task, and a focused task on a board makes both live.
    expect(findConflicts(clashing)).toContainEqual({
      chord: "e",
      commands: ["task.complete", "test.clash"],
      reason: "duplicate",
    });
  });

  it("catches a single key that would swallow the first step of a sequence", () => {
    const clashing: Command[] = [
      ...commands,
      {
        id: "test.prefix",
        title: "Group by",
        keys: ["g"],
        scope: "global",
        group: "Global",
        run: () => undefined,
      },
    ];
    expect(
      findConflicts(clashing).some((conflict) => conflict.reason === "prefix"),
    ).toBe(true);
  });
});

describe("surfaceOf", () => {
  it("recognises the projections a shortcut can act in", () => {
    expect(surfaceOf("/inbox")).toBe("list");
    expect(surfaceOf("/today")).toBe("list");
    expect(surfaceOf("/views/01a04e0f-2e8a-7000-ae0a-989d784c0287")).toBe("list");
    expect(surfaceOf("/projects/p1/board")).toBe("board");
    expect(surfaceOf("/tasks/ML-12")).toBe("detail");
    expect(surfaceOf("/settings/workspace")).toBe("other");
    expect(surfaceOf("/projects")).toBe("other");
  });
});

describe("scope resolution", () => {
  it("makes the route's own scope live alongside the global one", () => {
    expect([...activeScopes(on("list"))].sort()).toEqual(["global", "list"]);
    expect([...activeScopes(on("board"))].sort()).toEqual(["board", "global"]);
    expect([...activeScopes(on("other"))]).toEqual(["global"]);
  });

  it("adds the task scope only once a task is focused or open", () => {
    expect(activeScopes(on("list")).has("task")).toBe(false);
    expect(activeScopes(on("list", true)).has("task")).toBe(true);
    expect(activeScopes(on("detail", true)).has("task")).toBe(true);
  });

  it("offers a task shortcut only where a task is the subject", () => {
    const complete = commands.find((command) => command.id === "task.complete");
    expect(complete && isAvailable(complete, on("list"))).toBe(false);
    expect(complete && isAvailable(complete, on("list", true))).toBe(true);
    expect(complete && isAvailable(complete, on("other", true))).toBe(true);
  });

  it("offers a global shortcut everywhere, including on a settings page", () => {
    const capture = commands.find((command) => command.id === "app.capture");
    expect(capture && isAvailable(capture, on("other"))).toBe(true);
  });
});

describe("resolveCommand", () => {
  it("finds the command a completed chord runs", () => {
    expect(resolveCommand(commands, "g t", on("list"), ENABLED)?.id).toBe("go.today");
    expect(resolveCommand(commands, "mod+k", on("other"), ENABLED)?.id).toBe(
      "app.palette",
    );
  });

  it("accepts either key of a command that has two", () => {
    expect(resolveCommand(commands, "c", on("list"), ENABLED)?.id).toBe("app.capture");
    expect(resolveCommand(commands, "n", on("list"), ENABLED)?.id).toBe("app.capture");
  });

  it("refuses a task shortcut with no task in view", () => {
    expect(resolveCommand(commands, "e", on("list"), ENABLED)).toBeUndefined();
    expect(resolveCommand(commands, "e", on("list", true), ENABLED)?.id).toBe(
      "task.complete",
    );
  });

  it("does not confuse the t of `g t` with the t that plans a task for today", () => {
    expect(resolveCommand(commands, "t", on("list", true), ENABLED)?.id).toBe(
      "task.due.today",
    );
    expect(resolveCommand(commands, "g t", on("list", true), ENABLED)?.id).toBe(
      "go.today",
    );
  });
});

describe("the single-key setting", () => {
  it("silences plain keys and sequences but not the two ways back", () => {
    expect(resolveCommand(commands, "e", on("list", true), DISABLED)).toBeUndefined();
    expect(resolveCommand(commands, "g t", on("list"), DISABLED)).toBeUndefined();
    expect(resolveCommand(commands, "mod+k", on("list"), DISABLED)?.id).toBe(
      "app.palette",
    );
    expect(resolveCommand(commands, "?", on("list"), DISABLED)?.id).toBe("app.help");
  });

  it("keeps every chord live while the setting is on", () => {
    for (const command of commands) {
      for (const chord of command.keys) {
        expect(chordIsEnabled(command, chord, ENABLED)).toBe(true);
      }
    }
  });
});

describe("isPendingPrefix", () => {
  it("waits after g, which cannot mean anything on its own", () => {
    expect(isPendingPrefix(commands, "g", on("list"), ENABLED)).toBe(true);
  });

  it("does not wait after a key that starts no sequence", () => {
    expect(isPendingPrefix(commands, "e", on("list", true), ENABLED)).toBe(false);
  });

  it("does not wait once single-key shortcuts are off", () => {
    expect(isPendingPrefix(commands, "g", on("list"), DISABLED)).toBe(false);
  });
});

describe("adjacentStatus", () => {
  const backlog = status({ id: "s0", name: "Backlog", rank: "a", isDefault: false });
  const ready = status({ id: "s1", name: "Ready", rank: "b" });
  const doing = status({ id: "s2", name: "Doing", rank: "c", isDefault: false });

  it("steps forward and back through the project's own order", () => {
    const statuses = [doing, backlog, ready];
    expect(adjacentStatus(statuses, "s1", 1)?.name).toBe("Doing");
    expect(adjacentStatus(statuses, "s1", -1)?.name).toBe("Backlog");
  });

  it("stops at each end rather than wrapping round", () => {
    expect(adjacentStatus([backlog, ready, doing], "s2", 1)).toBeUndefined();
    expect(adjacentStatus([backlog, ready, doing], "s0", -1)).toBeUndefined();
  });

  it("skips archived columns, which no task may be moved into", () => {
    const archived = status({
      id: "s3",
      name: "Retired",
      rank: "bb",
      archivedAt: "2026-09-01T00:00:00.000Z",
      isDefault: false,
    });
    expect(adjacentStatus([backlog, ready, archived, doing], "s1", 1)?.name).toBe(
      "Doing",
    );
  });

  it("has no answer for a task that is in no column at all", () => {
    expect(adjacentStatus([backlog, ready], null, 1)).toBeUndefined();
  });
});

describe("running a command", () => {
  function task(overrides: Partial<TaskDto> = {}): TaskDto {
    return {
      id: "01a04e0f-2e8a-7000-ae0a-989d784c0287",
      key: "ML-1",
      workspaceId: "01a04e0f-2e8a-7000-ae0a-989d784c0288",
      taskNumber: 1,
      projectId: null,
      statusId: null,
      title: "Prepare research presentation",
      descriptionMd: null,
      priority: "none",
      dueDate: null,
      dueTime: null,
      dueTimezone: null,
      deferUntil: null,
      deadline: null,
      deadlineTime: null,
      dateWarnings: [],
      reminderOffsetMinutes: null,
    fields: {},
      parentTaskId: null,
      recurrence: null,
      seriesId: null,
      rank: "aa",
      isCompleted: false,
      completedAt: null,
      version: 1,
      tags: [],
      createdBy: { kind: "user", id: "u1" },
      lastActor: { kind: "user", id: "u1" },
      createdAt: "2026-08-29T09:00:00.000Z",
      updatedAt: "2026-08-29T09:00:00.000Z",
      deletedAt: null,
      dayPlans: [],
      subtaskProgress: null,
      relations: [],
      blocked: null,
      isBlocked: false,
      ...overrides,
    };
  }

  function run(id: string, overrides: Partial<ShortcutDeps>) {
    const table = buildCommands(deps(overrides));
    const command = table.find((entry) => entry.id === id);
    if (!command) throw new Error(`no command ${id}`);
    return command.run();
  }

  it("says so rather than failing silently when no task is focused", async () => {
    const announce = vi.fn();
    await run("task.complete", { announce, currentTask: async () => null });
    expect(announce).toHaveBeenCalledWith(
      "No task is focused. Move to a task and try again.",
    );
  });

  it("completes an open task and announces which one", async () => {
    const announce = vi.fn();
    const complete = vi.fn(async () => undefined);
    await run("task.complete", {
      announce,
      currentTask: async () => task(),
      actions: { ...deps().actions, complete },
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith("Completed Prepare research presentation.");
  });

  it("reopens a completed task instead of completing it twice", async () => {
    const reopen = vi.fn(async () => undefined);
    const announce = vi.fn();
    await run("task.complete", {
      announce,
      currentTask: async () => task({ isCompleted: true }),
      actions: { ...deps().actions, reopen },
    });
    expect(reopen).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith("Reopened Prepare research presentation.");
  });

  it("plans for tomorrow from the workspace's date, not the browser's", async () => {
    const setDueDate = vi.fn(async () => undefined);
    await run("task.due.tomorrow", {
      today: () => "2026-12-31",
      currentTask: async () => task(),
      actions: { ...deps().actions, setDueDate },
    });
    expect(setDueDate).toHaveBeenCalledWith(expect.anything(), "2027-01-01");
  });

  it("toggles My Day rather than adding a second plan", async () => {
    const removeFromDay = vi.fn(async () => undefined);
    await run("task.my-day", {
      currentTask: async () => task({ dayPlans: ["2026-09-05"] }),
      actions: { ...deps().actions, removeFromDay },
    });
    expect(removeFromDay).toHaveBeenCalledOnce();
  });

  it("explains that an Inbox task has no columns to move between", async () => {
    const announce = vi.fn();
    const moveByOneColumn = vi.fn(async () => null);
    await run("task.next-column", {
      announce,
      currentTask: async () => task({ projectId: null }),
      actions: { ...deps().actions, moveByOneColumn },
    });
    expect(moveByOneColumn).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      "Prepare research presentation is in the Inbox, which has no columns.",
    );
  });

  it("turns a failed action into words instead of swallowing it", async () => {
    const announce = vi.fn();
    await run("task.delete", {
      announce,
      currentTask: async () => task(),
      actions: {
        ...deps().actions,
        remove: async () => {
          throw new Error("Someone else changed this task.");
        },
      },
    });
    expect(announce).toHaveBeenCalledWith(
      "That did not work: Someone else changed this task.",
    );
  });
});

describe("nextDay", () => {
  it("crosses a month and a year boundary", () => {
    expect(nextDay("2026-09-30")).toBe("2026-10-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});
