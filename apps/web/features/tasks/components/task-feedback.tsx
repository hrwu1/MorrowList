"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  TaskFeedbackContext,
  useTaskFeedback,
  useTaskFeedbackStore,
} from "../hooks/use-task-feedback";

import { WipWarning } from "@/features/workspace/components/wip-warning";

export function TaskFeedbackProvider({ children }: { readonly children: ReactNode }) {
  const store = useTaskFeedbackStore();
  return (
    <TaskFeedbackContext.Provider value={store}>
      {children}
    </TaskFeedbackContext.Provider>
  );
}

/** An open task's feedback stays visible inside its desktop panel or mobile sheet. */
export function TaskFeedbackOutlet() {
  const { setTarget } = useTaskFeedback();
  return <div ref={setTarget} />;
}

/** Every task command, including shortcuts and undo, shares the same actionable warning. */
export function TaskFeedback() {
  const { warning, target, dismiss } = useTaskFeedback();
  if (!warning) return null;
  const content = (
    <WipWarning key={warning.sequence} warning={warning.value} onDismiss={dismiss} />
  );
  return target ? createPortal(content, target) : content;
}
