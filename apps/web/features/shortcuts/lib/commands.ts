import type { Priority, TaskDto } from "@morrowlist/contracts";

import type { Command } from "./registry";

/**
 * The command table (GAP-10).
 *
 * Every entry dispatches an action the app already has; none of them decides anything.
 * The table is a pure function of its dependencies so the whole thing — keys, scopes,
 * availability — can be unit-tested with stubs, and so the cheat sheet and the palette
 * read the same list the key handler does and cannot drift from it.
 *
 * `Cmd/Ctrl+Z` is the one command whose `when` matters for correctness rather than for
 * tidiness: with nothing on the undo stack it must not match, so the keystroke falls
 * through to the browser's own undo instead of being swallowed. The cheat sheet lists it
 * regardless, because it groups by `group` and never consults `when`.
 */

export interface TaskShortcutActions {
  readonly complete: (task: TaskDto) => Promise<void>;
  readonly reopen: (task: TaskDto) => Promise<void>;
  readonly setPriority: (task: TaskDto, priority: Priority) => Promise<void>;
  readonly setDueDate: (task: TaskDto, date: string) => Promise<void>;
  readonly addToDay: (task: TaskDto) => Promise<void>;
  readonly removeFromDay: (task: TaskDto) => Promise<void>;
  readonly remove: (task: TaskDto) => Promise<void>;
  /** Moves to the adjacent open column and answers with its name. */
  readonly moveByOneColumn: (
    task: TaskDto,
    direction: 1 | -1,
  ) => Promise<string | null>;
  /** Follows the focused row's own detail link, so navigation stays in one place. */
  readonly openDetail: (task: TaskDto) => void;
}

export interface ShortcutDeps {
  readonly navigate: (href: string) => void;
  readonly announce: (message: string) => void;
  readonly openSearch: () => void;
  readonly openCapture: () => void;
  readonly openPalette: () => void;
  readonly openCheatSheet: () => void;
  /** The undo stack (GAP-08): whether an offer is live, and how to take it. */
  readonly canUndo: () => boolean;
  readonly undo: () => void;
  /** The focused or open task, resolved when the key is pressed rather than on render. */
  readonly currentTask: () => Promise<TaskDto | null>;
  readonly today: () => string;
  readonly actions: TaskShortcutActions;
}

const PRIORITY_KEYS: readonly (readonly [string, Priority, string])[] = [
  ["1", "urgent", "Urgent"],
  ["2", "high", "High"],
  ["3", "medium", "Medium"],
  ["4", "low", "Low"],
  ["0", "none", "No priority"],
];

/** Tomorrow in the workspace's calendar, from a plain `YYYY-MM-DD` date. */
export function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function buildCommands(deps: ShortcutDeps): readonly Command[] {
  /**
   * Task commands share one shape: find the subject, act, say what happened. A shortcut
   * with no subject says so rather than failing silently, because a keyboard user has no
   * hover state to tell them which task the app thinks is current (spec 14).
   */
  function onTask(run: (task: TaskDto) => void | Promise<void>): () => Promise<void> {
    return async () => {
      const task = await deps.currentTask();
      if (!task) {
        deps.announce("No task is focused. Move to a task and try again.");
        return;
      }
      try {
        await run(task);
      } catch (error) {
        deps.announce(
          error instanceof Error
            ? `That did not work: ${error.message}`
            : "That did not work.",
        );
      }
    };
  }

  return [
    {
      id: "app.palette",
      title: "Open the command palette",
      keywords: "commands run actions",
      keys: ["mod+k"],
      scope: "global",
      group: "Global",
      alwaysEnabled: true,
      run: () => deps.openPalette(),
    },
    {
      id: "app.search",
      title: "Search tasks and projects",
      keywords: "find filter query",
      keys: ["/"],
      scope: "global",
      group: "Global",
      run: () => deps.openSearch(),
    },
    {
      id: "app.capture",
      title: "Capture a new task",
      keywords: "add create quick add new",
      keys: ["c", "n"],
      scope: "global",
      group: "Global",
      run: () => deps.openCapture(),
    },
    {
      id: "app.help",
      title: "Show keyboard shortcuts",
      keywords: "help cheat sheet keys",
      keys: ["?"],
      scope: "global",
      group: "Global",
      alwaysEnabled: true,
      run: () => deps.openCheatSheet(),
    },
    {
      id: "app.undo",
      title: "Undo the last change",
      keywords: "revert back restore",
      keys: ["mod+z"],
      scope: "global",
      group: "Global",
      alwaysEnabled: true,
      when: () => deps.canUndo(),
      run: () => deps.undo(),
    },

    {
      id: "go.inbox",
      title: "Go to Inbox",
      keys: ["g i"],
      scope: "global",
      group: "Navigate",
      run: () => deps.navigate("/inbox"),
    },
    {
      id: "go.today",
      title: "Go to Today",
      keys: ["g t"],
      scope: "global",
      group: "Navigate",
      run: () => deps.navigate("/today"),
    },
    {
      id: "go.upcoming",
      title: "Go to Upcoming",
      keys: ["g u"],
      scope: "global",
      group: "Navigate",
      run: () => deps.navigate("/upcoming"),
    },
    {
      id: "go.projects",
      title: "Go to Projects",
      keys: ["g p"],
      scope: "global",
      group: "Navigate",
      run: () => deps.navigate("/projects"),
    },

    {
      id: "task.open",
      title: "Open the focused task",
      keywords: "detail panel show",
      keys: ["o"],
      scope: "task",
      group: "Task",
      run: onTask((task) => {
        deps.actions.openDetail(task);
        deps.announce(`Opening ${task.title}.`);
      }),
    },
    {
      id: "task.complete",
      title: "Complete or reopen the focused task",
      keywords: "done tick check finish",
      keys: ["e"],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        if (task.isCompleted) {
          await deps.actions.reopen(task);
          deps.announce(`Reopened ${task.title}.`);
        } else {
          await deps.actions.complete(task);
          deps.announce(`Completed ${task.title}.`);
        }
      }),
    },
    {
      id: "task.next-column",
      title: "Move the focused task to the next column",
      keywords: "status forward advance",
      keys: ["]"],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        if (task.projectId === null) {
          deps.announce(`${task.title} is in the Inbox, which has no columns.`);
          return;
        }
        const name = await deps.actions.moveByOneColumn(task, 1);
        deps.announce(
          name
            ? `Moved ${task.title} to ${name}.`
            : `${task.title} is already in the last column.`,
        );
      }),
    },
    {
      id: "task.previous-column",
      title: "Move the focused task to the previous column",
      keywords: "status back",
      keys: ["["],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        if (task.projectId === null) {
          deps.announce(`${task.title} is in the Inbox, which has no columns.`);
          return;
        }
        const name = await deps.actions.moveByOneColumn(task, -1);
        deps.announce(
          name
            ? `Moved ${task.title} to ${name}.`
            : `${task.title} is already in the first column.`,
        );
      }),
    },
    ...PRIORITY_KEYS.map(([key, priority, label]) => ({
      id: `task.priority.${priority}`,
      title: `Set priority to ${label.toLowerCase()}`,
      keywords: "priority importance",
      keys: [key],
      scope: "task" as const,
      group: "Task",
      run: onTask(async (task) => {
        await deps.actions.setPriority(task, priority);
        deps.announce(`${task.title}: ${label}.`);
      }),
    })),
    {
      id: "task.due.today",
      title: "Plan the focused task for today",
      keywords: "due date schedule",
      keys: ["t"],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        const date = deps.today();
        await deps.actions.setDueDate(task, date);
        deps.announce(`${task.title} is planned for today, ${date}.`);
      }),
    },
    {
      id: "task.due.tomorrow",
      title: "Plan the focused task for tomorrow",
      keywords: "due date schedule",
      keys: ["m"],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        const date = nextDay(deps.today());
        await deps.actions.setDueDate(task, date);
        deps.announce(`${task.title} is planned for tomorrow, ${date}.`);
      }),
    },
    {
      id: "task.my-day",
      title: "Add the focused task to My Day, or take it out",
      keywords: "my day today plan",
      keys: ["d"],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        if (task.dayPlans.length > 0) {
          await deps.actions.removeFromDay(task);
          deps.announce(`Removed ${task.title} from My Day.`);
        } else {
          await deps.actions.addToDay(task);
          deps.announce(`Added ${task.title} to My Day.`);
        }
      }),
    },
    {
      id: "task.delete",
      title: "Move the focused task to Trash",
      keywords: "delete remove bin",
      keys: ["#"],
      scope: "task",
      group: "Task",
      run: onTask(async (task) => {
        await deps.actions.remove(task);
        deps.announce(`Moved ${task.title} to Trash.`);
      }),
    },
  ];
}
