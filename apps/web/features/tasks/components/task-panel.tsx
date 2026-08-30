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
    container.current?.focus();
  }, [idOrKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
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
