import type { TaskSyncStamp } from "../ports/index.js";

/**
 * CalDAV change tokens (RFC 6578) and the calendarserver ctag share one encoding: the
 * newest task change in the workspace and the task count, so a trash, a completion, or a
 * new task all move it. Nothing hard-deletes tasks, so a token never expires.
 */
export function encodeSyncToken(stamp: TaskSyncStamp): string {
  return `ml-${stamp.latest ? stamp.latest.getTime() : 0}-${stamp.count}`;
}

/** The point a token names, or null for a token this server never issued. */
export function decodeSyncToken(token: string): TaskSyncStamp | null {
  const match = /^ml-(\d{1,16})-(\d{1,9})$/.exec(token.trim());
  if (!match) return null;
  const millis = Number(match[1]);
  return { latest: millis === 0 ? null : new Date(millis), count: Number(match[2]) };
}
