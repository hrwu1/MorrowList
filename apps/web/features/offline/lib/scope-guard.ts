/**
 * Serializes private Cache API access with scope changes. A network read carries the
 * revision from when it began; a late response cannot reopen a revoked partition.
 */
export function createScopeGuard() {
  let revision = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    current: () => revision,
    isCurrent: (value: number) => value === revision,
    invalidate: () => ++revision,
    run<T>(value: number, operation: () => Promise<T>): Promise<T | undefined> {
      const next = tail.then(() => (value === revision ? operation() : undefined));
      // One failed Cache API operation must not prevent a later logout purge.
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
