"use client";

import { useEffect, useRef } from "react";

import { TaskDetail } from "./task-detail";

/**
 * Shared non-modal task detail panel used by list and board projections.
 *
 * The surrounding view remains visible and usable, so this is a labelled region rather
 * than a dialog. Escape closes it; the owner is responsible for returning focus to the
 * control that opened it because only the owner knows that control's id.
 */
export function TaskPanel({
  idOrKey,
  onClose,
}: {
  readonly idOrKey: string;
  readonly onClose: () => void;
}) {
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    const panel = container.current;
    panel?.focus({ preventScroll: true });
    // Between the phone sheet and the desktop side panel the panel stacks under the
    // list; below 45rem it is a fixed sheet that is already on screen.
    if (
      panel &&
      window.matchMedia("(min-width: 45.01rem) and (max-width: 59.99rem)").matches
    ) {
      // Next restores `scroll: false` after a route-query change. Let that settle before
      // positioning a stacked mobile panel, otherwise only its top border peeks onscreen.
      let settleFrame = 0;
      const layoutFrame = window.requestAnimationFrame(() => {
        settleFrame = window.requestAnimationFrame(() => {
          panel.scrollIntoView({ block: "start" });
        });
      });
      return () => {
        window.cancelAnimationFrame(layoutFrame);
        window.cancelAnimationFrame(settleFrame);
      };
    }
    return undefined;
  }, [idOrKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      className="task-panel"
      ref={container}
      tabIndex={-1}
      aria-label={`Task details for ${idOrKey}`}
    >
      <TaskDetail idOrKey={idOrKey} variant="panel" onClose={onClose} />
    </aside>
  );
}
