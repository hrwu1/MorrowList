"use client";

import type { WipWarningDto } from "@morrowlist/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
} from "react";

import {
  warningsFromResult,
  type TaskFeedbackResult,
} from "../lib/task-command-result";
import { createTaskSession, type TaskSession } from "../lib/task-session";

interface TaskFeedbackStore {
  readonly session: TaskSession;
  readonly warning: { readonly value: WipWarningDto; readonly sequence: number } | null;
  readonly target: HTMLElement | null;
  readonly setTarget: (target: HTMLDivElement | null) => void;
  readonly report: (result: TaskFeedbackResult) => void;
  readonly dismiss: () => void;
}

const noop = () => {};
const empty: TaskFeedbackStore = {
  session: createTaskSession(),
  warning: null,
  target: null,
  setTarget: noop,
  report: noop,
  dismiss: noop,
};
export const TaskFeedbackContext = createContext<TaskFeedbackStore>(empty);

export function useTaskFeedbackStore(): TaskFeedbackStore {
  const [session] = useState(createTaskSession);
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
  useEffect(
    () =>
      session.subscribe(() => {
        setWarning(null);
      }),
    [session],
  );
  return useMemo(
    () => ({ session, warning, target, setTarget, report, dismiss }),
    [session, warning, target, report, dismiss],
  );
}

export function useTaskFeedback(): TaskFeedbackStore {
  return useContext(TaskFeedbackContext);
}

/** Authentication boundaries activate a session; ordinary project/view navigation does not. */
export function useTaskSession(owner: string): void {
  const { session } = useTaskFeedback();
  useLayoutEffect(() => {
    const revision = session.begin(owner);
    return () => session.end(revision);
  }, [session, owner]);
}
