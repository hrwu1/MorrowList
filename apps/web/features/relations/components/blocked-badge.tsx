import type { TaskDto } from "@morrowlist/contracts";

import { blockedSummary } from "../lib/relations";

/**
 * The Blocked indicator (spec 8.4, 9.5): a word, not only a colour, with the reason on
 * hover and in the accessible name so a card says why without opening it.
 */
export function BlockedBadge({ task }: { readonly task: TaskDto }) {
  const summary = blockedSummary(task);
  if (!summary) return null;
  return (
    <span
      className="task-row__blocked"
      title={summary}
      aria-label={`Blocked: ${summary}`}
      data-flagged={task.blocked !== null || undefined}
    >
      Blocked
    </span>
  );
}
