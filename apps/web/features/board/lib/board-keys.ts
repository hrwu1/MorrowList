import type { BoardViewQuery } from "@morrowlist/contracts";

/**
 * Query keys for the cross-project board (GAP-19). They live apart from the hooks so
 * every mutation that changes a task can invalidate the board without importing it.
 */
export const boardViewKeys = {
  all: ["views", "board"] as const,
  view: (query: Partial<BoardViewQuery>) => [...boardViewKeys.all, query] as const,
};
