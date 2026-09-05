"use client";

import { Button } from "@morrowlist/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { UndoContext, useUndo, useUndoStore } from "../hooks/use-undo";
import { UNDO_WINDOW_MS } from "../lib/undo";

/**
 * The undo toast (spec 10.3).
 *
 * It sits at the bottom of the shell for eight seconds after an undoable command, names
 * what it would take back, and sends the compensating command. It is a live region, so a
 * screen reader hears the offer without the focus moving: the toast interrupts nothing,
 * which is the whole point of an eight-second window rather than a confirmation dialog.
 */

export function UndoProvider({ children }: { readonly children: ReactNode }) {
  const store = useUndoStore();
  return <UndoContext.Provider value={store}>{children}</UndoContext.Provider>;
}

export function UndoToast() {
  const { entry, status, error, undo, dismiss } = useUndo();
  const queryClient = useQueryClient();

  // Close the toast when its window runs out. One timer per offer, not a ticking clock:
  // nothing about the toast changes in between.
  useEffect(() => {
    if (!entry) return;
    const remaining = Math.max(0, entry.expiresAt - Date.now());
    const timer = window.setTimeout(dismiss, remaining);
    return () => window.clearTimeout(timer);
  }, [entry, dismiss]);

  // A failure notice does not deserve the same eight seconds as the offer, but it must
  // not sit there forever either.
  useEffect(() => {
    if (status !== "failed") return;
    const timer = window.setTimeout(dismiss, UNDO_WINDOW_MS * 2);
    return () => window.clearTimeout(timer);
  }, [status, dismiss]);

  /*
   * Cmd/Ctrl+Z, only while the toast is open. GAP-10 owns the shortcut registry under
   * `features/shortcuts`; until that lands this stays local, which also keeps the binding
   * scoped to exactly the moment it means something.
   */
  useEffect(() => {
    if (!entry) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      // Never steal the browser's own undo out of a field the user is typing in.
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entry, undo]);

  const visible = entry !== null || status === "failed";

  return (
    <output className="undo-toast-region" aria-live="polite">
      {visible ? (
        <div
          className="undo-toast"
          data-tone={status === "failed" ? "error" : undefined}
          data-testid="undo-toast"
        >
          {status === "failed" ? (
            <>
              <span className="undo-toast__label">{error}</span>
              <Button
                variant="ghost"
                onClick={() => {
                  // Nothing was overwritten; the cache is simply behind (spec 24.3).
                  void queryClient.invalidateQueries();
                  dismiss();
                }}
              >
                Refresh
              </Button>
            </>
          ) : (
            <>
              <span className="undo-toast__label">{entry?.label}</span>
              <Button
                variant="ghost"
                loading={status === "running"}
                onClick={undo}
                aria-label={`Undo: ${entry?.label ?? ""}`}
              >
                Undo
                <kbd aria-hidden="true">⌘Z</kbd>
              </Button>
            </>
          )}
          <button
            type="button"
            className="undo-toast__dismiss"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            ×
          </button>
        </div>
      ) : null}
    </output>
  );
}
