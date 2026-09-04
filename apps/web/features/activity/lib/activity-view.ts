import type { ActivityChangeDto, ActivityEntryDto } from "@morrowlist/contracts";

/**
 * Pure presentation rules for activity entries (spec 10.2, 26.2). Only mapped fields are
 * ever rendered; the raw payload never reaches the screen.
 */

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  descriptionMd: "Description",
  priority: "Priority",
  dueDate: "Due date",
  dueTime: "Due time",
  dueTimezone: "Time zone",
  recurrence: "Repeat",
};

const ACTOR_KIND_LABELS: Record<ActivityEntryDto["actorKind"], string> = {
  user: "User",
  api_key: "API key",
  system: "System",
  integration: "Integration",
  agent: "Agent",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Who did it: the snapshot name, or the actor kind when no name was recorded. */
export function actorLabel(entry: ActivityEntryDto): string {
  return entry.actorDisplayName ?? ACTOR_KIND_LABELS[entry.actorKind];
}

/** Non-human actors are flagged so an API key's change is never mistaken for a person's. */
export function actorBadge(entry: ActivityEntryDto): string | null {
  return entry.actorKind === "user" ? null : ACTOR_KIND_LABELS[entry.actorKind];
}

export function formatChange(change: ActivityChangeDto): string {
  return `${fieldLabel(change.field)}: ${change.from ?? "none"} → ${change.to ?? "none"}`;
}

/** One readable line per entry; what the snapshot test pins for every event type. */
export function describeEntry(entry: ActivityEntryDto): string {
  const changes = entry.changes.map(formatChange);
  return [entry.summary, ...changes].join(" · ");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 days ago"; the absolute time lives in the tooltip. */
export function relativeTime(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < 45_000) return "just now";

  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (elapsed < HOUR) return format.format(-Math.round(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return format.format(-Math.round(elapsed / HOUR), "hour");
  if (elapsed < 30 * DAY) return format.format(-Math.round(elapsed / DAY), "day");
  if (elapsed < 365 * DAY) {
    return format.format(-Math.round(elapsed / (30 * DAY)), "month");
  }
  return format.format(-Math.round(elapsed / (365 * DAY)), "year");
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
