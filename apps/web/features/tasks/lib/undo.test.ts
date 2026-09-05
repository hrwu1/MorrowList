import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  UNDO_WINDOW_MS,
  createUndoEntry,
  currentEntry,
  dropEntry,
  isExpired,
  isUndoConflict,
  neighboursOf,
  pushEntry,
  remainingMs,
  undoBatchLabel,
  undoErrorMessage,
  undoLabel,
} from "./undo";

const NOW = 1_700_000_000_000;

const offer = (id: string) => ({
  id,
  label: id,
  compensate: () => Promise.resolve(),
});

function task(overrides: Partial<TaskDto>): TaskDto {
  return {
    id: "t",
    rank: "m",
    projectId: "p",
    statusId: "s",
    deletedAt: null,
    title: "Draft the brief",
    ...overrides,
  } as TaskDto;
}

describe("the undo window", () => {
  it("expires eight seconds after the mutation", () => {
    const entry = createUndoEntry(offer("a"), NOW);

    expect(entry.expiresAt).toBe(NOW + UNDO_WINDOW_MS);
    expect(isExpired(entry, NOW + UNDO_WINDOW_MS - 1)).toBe(false);
    expect(isExpired(entry, NOW + UNDO_WINDOW_MS)).toBe(true);
    expect(remainingMs(entry, NOW + 3_000)).toBe(UNDO_WINDOW_MS - 3_000);
    // A countdown never runs past zero.
    expect(remainingMs(entry, NOW + 60_000)).toBe(0);
  });

  it("offers only the newest live entry and forgets expired ones", () => {
    const old = createUndoEntry(offer("old"), NOW);
    const fresh = createUndoEntry(offer("fresh"), NOW + 1_000);
    const stack = pushEntry([old], fresh, NOW + 1_000);

    expect(stack).toHaveLength(2);
    expect(currentEntry(stack, NOW + 1_000)?.id).toBe("fresh");
    // Once the older window closes it is no longer a candidate, and never a dead button.
    expect(currentEntry([old], NOW + UNDO_WINDOW_MS)).toBeNull();
    // Pushing prunes what has already expired rather than growing without bound.
    expect(
      pushEntry(stack, createUndoEntry(offer("third"), NOW + 20_000), NOW + 20_000),
    ).toHaveLength(1);
  });

  it("drops an entry once it has been used", () => {
    const stack = [createUndoEntry(offer("a"), NOW), createUndoEntry(offer("b"), NOW)];
    expect(dropEntry(stack, "b").map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("neighboursOf", () => {
  const above = task({ id: "above", rank: "d" });
  const below = task({ id: "below", rank: "v" });
  const elsewhere = task({ id: "elsewhere", rank: "e", statusId: "other" });
  const trashed = task({ id: "trashed", rank: "f", deletedAt: "2026-09-01T00:00:00Z" });
  const subject = task({ id: "subject", rank: "m" });

  it("names the card above and the card below in the task's own scope", () => {
    expect(neighboursOf(subject, [below, elsewhere, trashed, above, subject])).toEqual({
      beforeTaskId: "above",
      afterTaskId: "below",
    });
  });

  it("reports an open end as null rather than inventing an anchor", () => {
    expect(neighboursOf(subject, [below, subject])).toEqual({
      beforeTaskId: null,
      afterTaskId: "below",
    });
    expect(neighboursOf(subject, [subject])).toEqual({
      beforeTaskId: null,
      afterTaskId: null,
    });
  });
});

describe("undo failure reporting", () => {
  it("tells a concurrent change apart from an ordinary failure", () => {
    // Spec 24.3: a stale undo must report the conflict, never overwrite the newer change.
    expect(isUndoConflict({ code: "TASK_VERSION_CONFLICT" })).toBe(true);
    expect(isUndoConflict({ code: "TASK_NOT_FOUND" })).toBe(false);
    expect(isUndoConflict(null)).toBe(false);

    expect(undoErrorMessage({ code: "VERSION_CONFLICT" })).toMatch(/somewhere else/);
    expect(undoErrorMessage(new Error("Network down"))).toBe("Network down");
    expect(undoErrorMessage(undefined)).toBe("That could not be undone.");
  });
});

describe("undo labels", () => {
  it("names what would be taken back", () => {
    expect(undoLabel("Completed", task({}))).toBe("Completed Draft the brief");
    expect(undoBatchLabel("moved", 1)).toBe("1 task moved");
    expect(undoBatchLabel("moved", 12)).toBe("12 tasks moved");
  });
});
