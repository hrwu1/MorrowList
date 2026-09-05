import {
  PROJECT_EVENTS,
  TASK_EVENTS,
  WORKSPACE_EVENTS,
  type ActivityEntryDto,
} from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  actorBadge,
  actorLabel,
  describeEntry,
  formatChange,
  relativeTime,
} from "./activity-view";

function entry(overrides: Partial<ActivityEntryDto>): ActivityEntryDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000009",
    workspaceId: "01a04e0f-0000-7000-8000-000000000002",
    aggregateType: "task",
    aggregateId: "01a04e0f-0000-7000-8000-000000000001",
    eventType: "task.updated",
    actorKind: "user",
    actorId: "u1",
    actorDisplayName: "Alex",
    summary: "Updated task fields",
    payload: {},
    createdAt: "2026-08-29T09:00:00.000Z",
    changes: [],
    ...overrides,
  };
}

/** The summary each command records, with the changes the read model derives for it. */
const CATALOGUE: Record<string, Partial<ActivityEntryDto>> = {
  [TASK_EVENTS.created]: { summary: "Created task ML-1" },
  [TASK_EVENTS.updated]: {
    summary: "Updated task fields",
    changes: [
      { field: "title", from: "Draft brief", to: "Draft the brief" },
      { field: "priority", from: "none", to: "high" },
      { field: "dueDate", from: null, to: "2026-09-15" },
      { field: "deferUntil", from: null, to: "2026-09-10" },
      { field: "deadline", from: "2026-09-20", to: null },
      { field: "descriptionMd", from: null, to: "## Notes" },
    ],
  },
  [TASK_EVENTS.moved]: { summary: "Moved task to another status" },
  [TASK_EVENTS.reordered]: { summary: "Reordered task" },
  [TASK_EVENTS.completed]: { summary: "Completed task" },
  [TASK_EVENTS.reopened]: { summary: "Reopened task" },
  [TASK_EVENTS.deleted]: { summary: "Moved task to Trash" },
  [TASK_EVENTS.restored]: { summary: "Restored task from Trash" },
  [TASK_EVENTS.dayAdded]: { summary: "Added task to My Day for 2026-08-29" },
  [TASK_EVENTS.dayRemoved]: { summary: "Removed task from My Day for 2026-08-29" },
  [TASK_EVENTS.parentChanged]: { summary: "Made task a subtask" },
  [TASK_EVENTS.tagAdded]: { summary: "Added tag Focus" },
  [TASK_EVENTS.tagRemoved]: { summary: "Removed tag Focus" },
  [TASK_EVENTS.relationAdded]: { summary: "Added relation: blocks ML-2" },
  [TASK_EVENTS.relationRemoved]: { summary: "Removed relation: blocked by ML-1" },
  [TASK_EVENTS.blocked]: { summary: "Marked task blocked: waiting on vendor" },
  [TASK_EVENTS.unblocked]: { summary: "Cleared the blocked flag" },
  [TASK_EVENTS.occurrenceSkipped]: {
    summary: "Skipped occurrence due 2026-09-03",
    changes: [{ field: "dueDate", from: "2026-09-03", to: "2026-09-10" }],
  },
  [TASK_EVENTS.reminderSent]: {
    actorKind: "system",
    actorDisplayName: "MorrowList",
    summary: "Sent reminder for ML-1",
  },
  [TASK_EVENTS.reminderSnoozed]: { summary: "Snoozed reminder for 60 minutes" },
  [PROJECT_EVENTS.created]: {
    aggregateType: "project",
    summary: "Created project Launch",
  },
  [PROJECT_EVENTS.updated]: { aggregateType: "project", summary: "Updated project" },
  [PROJECT_EVENTS.archived]: { aggregateType: "project", summary: "Archived project" },
  [PROJECT_EVENTS.restored]: { aggregateType: "project", summary: "Restored project" },
  [WORKSPACE_EVENTS.created]: {
    aggregateType: "workspace",
    summary: "Created workspace Alex's Workspace",
  },
  [WORKSPACE_EVENTS.updated]: {
    aggregateType: "workspace",
    summary: "Updated workspace Alex's Workspace",
  },
  [WORKSPACE_EVENTS.digestSent]: {
    aggregateType: "workspace",
    actorKind: "system",
    actorDisplayName: "MorrowList",
    summary: "Sent Today digest for 2026-08-29",
  },
  [WORKSPACE_EVENTS.notificationPreferencesUpdated]: {
    aggregateType: "workspace",
    summary: "Updated notification preferences",
  },
  [WORKSPACE_EVENTS.imported]: {
    aggregateType: "workspace",
    summary: "Imported 24 tasks from Trello into Website Relaunch",
  },
};

describe("describeEntry", () => {
  it("renders a readable line for every event type in the catalogue", () => {
    const catalogued = [
      ...Object.values(TASK_EVENTS),
      ...Object.values(PROJECT_EVENTS),
      ...Object.values(WORKSPACE_EVENTS),
    ];
    expect(Object.keys(CATALOGUE).sort()).toEqual([...catalogued].sort());

    const lines = Object.fromEntries(
      catalogued.map((eventType) => [
        eventType,
        describeEntry(entry({ eventType, ...CATALOGUE[eventType] })),
      ]),
    );

    for (const line of Object.values(lines)) expect(line.length).toBeGreaterThan(0);
    expect(lines).toMatchSnapshot();
  });
});

describe("formatChange", () => {
  it("labels the field and spells out a cleared value", () => {
    expect(formatChange({ field: "dueDate", from: "2026-09-15", to: null })).toBe(
      "Due date: 2026-09-15 → none",
    );
    expect(formatChange({ field: "unknownField", from: "a", to: "b" })).toBe(
      "unknownField: a → b",
    );
  });
});

describe("actor presentation", () => {
  it("names a person and flags anything that is not one", () => {
    const person = entry({});
    expect(actorLabel(person)).toBe("Alex");
    expect(actorBadge(person)).toBeNull();

    const key = entry({ actorKind: "api_key", actorDisplayName: null });
    expect(actorLabel(key)).toBe("API key");
    expect(actorBadge(key)).toBe("API key");

    const named = entry({ actorKind: "integration", actorDisplayName: "GitHub" });
    expect(actorLabel(named)).toBe("GitHub");
    expect(actorBadge(named)).toBe("Integration");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");

  it("rounds to the largest sensible unit", () => {
    expect(relativeTime("2026-08-29T11:59:40.000Z", now)).toBe("just now");
    expect(relativeTime("2026-08-29T11:55:00.000Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-08-29T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-08-26T12:00:00.000Z", now)).toBe("3 days ago");
    expect(relativeTime("2026-06-29T12:00:00.000Z", now)).toBe("2 months ago");
    expect(relativeTime("2024-08-29T12:00:00.000Z", now)).toBe("2 years ago");
  });
});
