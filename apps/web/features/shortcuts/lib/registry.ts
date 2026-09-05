import type { WorkflowStatusDto } from "@morrowlist/contracts";

import { chordSteps, isChordPrefix } from "./keys";

/**
 * The shortcut registry (GAP-10).
 *
 * Commands are data, never behaviour: a command says what it is called, which chords
 * reach it, where it applies, and which existing action it dispatches. Nothing in this
 * module knows about React, and no rule is implemented here — `run` always delegates to
 * an action the app already has, so the keyboard cannot drift from the mouse.
 */

export type ShortcutScope = "global" | "list" | "board" | "detail" | "task";

/** Where the user is, as far as a shortcut is concerned. */
export type ShortcutSurface = "list" | "board" | "detail" | "other";

export interface ShortcutContext {
  readonly surface: ShortcutSurface;
  /** A task is focused in a list or on a board, or its detail is open. */
  readonly hasTask: boolean;
}

export interface Command {
  readonly id: string;
  /** The sentence the palette and the cheat sheet show. */
  readonly title: string;
  /** Extra words the palette matches on but does not display. */
  readonly keywords?: string;
  readonly keys: readonly string[];
  readonly scope: ShortcutScope;
  /** Cheat-sheet and palette heading. */
  readonly group: string;
  /** Narrows a scope further, e.g. a board-only command inside the task scope. */
  readonly when?: (context: ShortcutContext) => boolean;
  /**
   * Stays live when single-key shortcuts are switched off, so the cheat sheet and the
   * palette — the two ways back to the setting — can never be locked away.
   */
  readonly alwaysEnabled?: boolean;
  readonly run: () => void | Promise<void>;
}

export const COMMAND_GROUPS = ["Global", "Navigate", "Task"] as const;

/** Which route the user is on, in the terms the registry cares about. */
export function surfaceOf(pathname: string): ShortcutSurface {
  if (pathname.startsWith("/tasks/")) return "detail";
  if (/^\/projects\/[^/]+\/board/.test(pathname)) return "board";
  if (
    pathname === "/inbox" ||
    pathname === "/today" ||
    pathname === "/upcoming" ||
    pathname === "/completed" ||
    pathname === "/trash" ||
    pathname === "/search" ||
    pathname.startsWith("/views/")
  ) {
    return "list";
  }
  return "other";
}

/** The scopes that are live right now. `global` always is; `task` needs a task. */
export function activeScopes(context: ShortcutContext): ReadonlySet<ShortcutScope> {
  const scopes = new Set<ShortcutScope>(["global"]);
  if (context.surface !== "other") scopes.add(context.surface);
  if (context.hasTask) scopes.add("task");
  return scopes;
}

export function isAvailable(command: Command, context: ShortcutContext): boolean {
  if (!activeScopes(context).has(command.scope)) return false;
  return command.when ? command.when(context) : true;
}

export interface ResolveOptions {
  /** False once the user has switched single-key shortcuts off in the cheat sheet. */
  readonly singleKeyEnabled: boolean;
}

/** Whether a chord survives the single-key setting. `mod+…` chords always do. */
export function chordIsEnabled(
  command: Command,
  chord: string,
  options: ResolveOptions,
): boolean {
  if (options.singleKeyEnabled) return true;
  if (command.alwaysEnabled) return true;
  return chord.startsWith("mod+");
}

/** The command a completed chord runs here, if any. */
export function resolveCommand(
  commands: readonly Command[],
  chord: string,
  context: ShortcutContext,
  options: ResolveOptions,
): Command | undefined {
  return commands.find(
    (command) =>
      command.keys.includes(chord) &&
      isAvailable(command, context) &&
      chordIsEnabled(command, chord, options),
  );
}

/** True when the keystroke so far could still grow into a binding, e.g. `g` before `g t`. */
export function isPendingPrefix(
  commands: readonly Command[],
  prefix: string,
  context: ShortcutContext,
  options: ResolveOptions,
): boolean {
  return commands.some(
    (command) =>
      isAvailable(command, context) &&
      command.keys.some(
        (chord) =>
          isChordPrefix(prefix, chord) && chordIsEnabled(command, chord, options),
      ),
  );
}

/**
 * Scopes that can be live at the same moment. Two commands only clash if theirs can.
 * `list`, `board` and `detail` are mutually exclusive — one route at a time — while
 * `global` and `task` overlap with everything.
 */
function scopesCanOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a === b) return true;
  if (a === "global" || b === "global") return true;
  if (a === "task" || b === "task") return true;
  return false;
}

export interface ShortcutConflict {
  readonly chord: string;
  readonly commands: readonly [string, string];
  readonly reason: "duplicate" | "prefix";
}

/**
 * Every way two bindings could fight: the same chord in scopes that can be live together,
 * and a single key that is also the first step of a sequence (pressing it would either
 * swallow the sequence or delay the single key). A unit test fails on any of them.
 */
export function findConflicts(
  commands: readonly Command[],
): readonly ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];
  for (let i = 0; i < commands.length; i += 1) {
    for (let j = i + 1; j < commands.length; j += 1) {
      const a = commands[i] as Command;
      const b = commands[j] as Command;
      if (!scopesCanOverlap(a.scope, b.scope)) continue;
      for (const chordA of a.keys) {
        for (const chordB of b.keys) {
          if (chordA === chordB) {
            conflicts.push({
              chord: chordA,
              commands: [a.id, b.id],
              reason: "duplicate",
            });
          } else if (isChordPrefix(chordA, chordB) || isChordPrefix(chordB, chordA)) {
            conflicts.push({
              chord:
                chordSteps(chordA).length < chordSteps(chordB).length ? chordA : chordB,
              commands: [a.id, b.id],
              reason: "prefix",
            });
          }
        }
      }
    }
  }
  return conflicts;
}

/** Duplicate chords inside one command's own key list, which no scope rule can excuse. */
export function findDuplicateKeysWithinCommands(
  commands: readonly Command[],
): readonly string[] {
  return commands.flatMap((command) => {
    const seen = new Set<string>();
    return command.keys.filter((chord) => {
      if (seen.has(chord)) return true;
      seen.add(chord);
      return false;
    });
  });
}

/**
 * The column beside the focused task's own, in the project's authoritative order.
 *
 * This is navigation over an order the server already decided (the `rank` column, whose
 * code-point order the board also relies on), not a workflow rule: the move itself goes
 * to the move endpoint, which enforces WIP limits, completion transitions and the rest.
 */
export function adjacentStatus(
  statuses: readonly WorkflowStatusDto[],
  currentStatusId: string | null,
  direction: 1 | -1,
): WorkflowStatusDto | undefined {
  const open = statuses
    .filter((status) => status.archivedAt === null)
    .slice()
    .sort((left, right) =>
      left.rank === right.rank
        ? left.id < right.id
          ? -1
          : 1
        : left.rank < right.rank
          ? -1
          : 1,
    );
  const index = open.findIndex((status) => status.id === currentStatusId);
  if (index === -1) return undefined;
  return open[index + direction];
}
