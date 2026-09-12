import { createScopeGuard } from "../../offline/lib/scope-guard";

/** A late command may finish after sign-out; its UI/cache effects belong to its session. */
export function createTaskSession() {
  const guard = createScopeGuard();
  const listeners = new Set<() => void>();
  let owner: string | null = null;
  const change = (next: string | null) => {
    owner = next;
    const revision = guard.invalidate();
    for (const listener of listeners) listener();
    return revision;
  };
  return {
    current: guard.current,
    isCurrent: (revision: number) => owner !== null && guard.isCurrent(revision),
    begin: (next: string) => change(next),
    end: (revision: number = guard.current()) => {
      if (guard.isCurrent(revision)) change(null);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type TaskSession = ReturnType<typeof createTaskSession>;
