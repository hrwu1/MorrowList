"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  createUndoEntry,
  currentEntry,
  dropEntry,
  pushEntry,
  undoErrorMessage,
  type UndoEntry,
  type UndoOffer,
} from "../lib/undo";

/**
 * The undo offer a mutation leaves behind (spec 10.3).
 *
 * Every undoable command offers from inside its own hook rather than from each call site,
 * so completing a task from a row, the detail panel, or a board card all leave the same
 * offer. The context tolerates being absent — `offer` is then a no-op — so a component
 * rendered outside the shell (a test, a storybook, the sign-in route) still works.
 */

export interface UndoState {
  readonly entry: UndoEntry | null;
  readonly status: "idle" | "running" | "failed";
  readonly error: string | null;
  readonly offer: (offer: UndoOffer) => void;
  readonly undo: () => void;
  readonly dismiss: () => void;
}

interface UndoStore {
  readonly stack: readonly UndoEntry[];
  readonly setStack: Dispatch<SetStateAction<readonly UndoEntry[]>>;
  readonly status: UndoState["status"];
  readonly setStatus: Dispatch<SetStateAction<UndoState["status"]>>;
  readonly error: string | null;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  /** Bumped when the window ticks over, so the toast re-evaluates what is still live. */
  readonly setClock: Dispatch<SetStateAction<number>>;
  readonly clock: number;
}

export const UndoContext = createContext<UndoStore | null>(null);

/** The store the provider component owns; kept here so the provider stays declarative. */
export function useUndoStore(): UndoStore {
  const [stack, setStack] = useState<readonly UndoEntry[]>([]);
  const [status, setStatus] = useState<UndoState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  return useMemo(
    () => ({ stack, setStack, status, setStatus, error, setError, clock, setClock }),
    [stack, status, error, clock],
  );
}

export function useUndo(): UndoState {
  const store = useContext(UndoContext);

  const offer = useCallback(
    (next: UndoOffer) => {
      if (!store) return;
      const now = Date.now();
      store.setError(null);
      store.setStatus("idle");
      // A second mutation on the same task replaces its offer rather than queueing one.
      store.setStack((current) =>
        pushEntry(dropEntry(current, next.id), createUndoEntry(next, now), now),
      );
      store.setClock(now);
    },
    [store],
  );

  const dismiss = useCallback(() => {
    if (!store) return;
    store.setStack([]);
    store.setStatus("idle");
    store.setError(null);
  }, [store]);

  const entry = store ? currentEntry(store.stack, store.clock) : null;

  const undo = useCallback(() => {
    if (!store || !entry || store.status === "running") return;
    store.setStatus("running");
    store.setError(null);
    // The offer is consumed the moment it is used: a failed undo is reported, not retried
    // silently, and the same compensating command is never sent twice.
    store.setStack((current) => dropEntry(current, entry.id));
    void entry
      .compensate()
      .then(() => {
        store.setStatus("idle");
      })
      .catch((failure: unknown) => {
        store.setStatus("failed");
        store.setError(undoErrorMessage(failure));
      });
  }, [entry, store]);

  return {
    entry,
    status: store?.status ?? "idle",
    error: store?.error ?? null,
    offer,
    undo,
    dismiss,
  };
}
