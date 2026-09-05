import type { ActivityChangeDto, ActivityEntryDto } from "@morrowlist/contracts";
import { describeRecurrence, type RecurrenceRule } from "@morrowlist/domain";

import type { ActivityEvent } from "../ports/index.js";

/**
 * Activity event to read-model mapping (ACT-001). Summaries are stored at write time;
 * this only derives the displayable `changes` from the payload's `changes` diff.
 *
 * Only fields a person edits by hand surface here. Ids, ranks, and timestamps stay in
 * the payload: the summary already says "moved" or "completed", and a UUID is not a
 * readable diff (spec 26.2).
 */

const DISPLAYED_FIELDS = [
  "title",
  "descriptionMd",
  "priority",
  "dueDate",
  "dueTime",
  "dueTimezone",
  "recurrence",
  "deferUntil",
  "deadline",
  "deadlineTime",
  "reminderOffsetMinutes",
  "fields",
] as const;

/** A description can be 50,000 characters; the history shows enough to recognise it. */
export const DESCRIPTION_PREVIEW_LENGTH = 120;

export function toActivityEntryDto(event: ActivityEvent): ActivityEntryDto {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    actorKind: event.actorKind,
    actorId: event.actorId,
    actorDisplayName: event.actorDisplayName,
    summary: event.summary,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
    changes: changesOf(event.payload),
  };
}

export function changesOf(payload: Record<string, unknown>): ActivityChangeDto[] {
  const diff = payload.changes;
  if (!isRecord(diff)) return [];

  return DISPLAYED_FIELDS.flatMap((field) => {
    const change = diff[field];
    if (!isRecord(change)) return [];
    return [
      {
        field,
        from: displayValue(field, change.from),
        to: displayValue(field, change.to),
      },
    ];
  });
}

function displayValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (field === "recurrence" && isRecord(value)) {
    return describeRecurrence(value as unknown as RecurrenceRule);
  }
  if (field === "fields" && isRecord(value)) {
    // Typed custom values (GAP-24) read as "key: value" pairs; an empty map is "none".
    const entries = Object.entries(value);
    return entries.length === 0
      ? null
      : entries.map(([key, each]) => `${key}: ${String(each)}`).join(", ");
  }
  const text = typeof value === "string" ? value : String(value);
  if (field === "descriptionMd" && text.length > DESCRIPTION_PREVIEW_LENGTH) {
    return `${text.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`;
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
