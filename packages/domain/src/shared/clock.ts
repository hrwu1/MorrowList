/**
 * Time is injected rather than read from the ambient clock so completion, due-date, and
 * retention policies are deterministically testable.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Fixed clock for tests and for holding one timestamp steady across a transaction. */
export function fixedClock(instant: Date): Clock {
  return { now: () => new Date(instant.getTime()) };
}
