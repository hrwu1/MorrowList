"use client";

import type { WipWarningDto } from "@morrowlist/contracts";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  warningsFromResult,
  type TaskFeedbackResult,
} from "../lib/task-command-result";

interface TaskFeedbackStore {
  readonly warning: { readonly value: WipWarningDto; readonly sequence: number } | null;
  readonly target: HTMLElement | null;
  readonly setTarget: (target: HTMLDivElement | null) => void;
  readonly report: (result: TaskFeedbackResult) => void;
  readonly dismiss: () => void;
}

const noop = () => {};
const empty: TaskFeedbackStore = {
  warning: null,
  target: null,
  setTarget: noop,
  report: noop,
  dismiss: noop,
};
export const TaskFeedbackContext = createContext<TaskFeedbackStore>(empty);

export function useTaskFeedbackStore(): TaskFeedbackStore {
  const [warning, setWarning] = useState<TaskFeedbackStore["warning"]>(null);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const report = useCallback((result: TaskFeedbackResult) => {
    const next = warningsFromResult(result)[0];
    // Successful corrective actions do not dismiss the remaining tasks in the warning.
    if (next)
      setWarning((current) => ({
        value: next,
        sequence: (current?.sequence ?? 0) + 1,
      }));
  }, []);
  const dismiss = useCallback(() => setWarning(null), []);
  return useMemo(
    () => ({ warning, target, setTarget, report, dismiss }),
    [warning, target, report, dismiss],
  );
}

export function useTaskFeedback(): TaskFeedbackStore {
  return useContext(TaskFeedbackContext);
}
