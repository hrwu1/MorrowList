import type {
  TaskDto,
  TodayViewResponse,
  UpcomingViewResponse,
  BoardViewResponse,
  SearchResponse,
} from "@morrowlist/contracts";
import { QueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import {
  cachedTasks,
  cancelTaskProjections,
  invalidateTaskProjections,
  isTaskProjection,
  patchTaskEverywhere,
  restoreTaskProjections,
  snapshotTaskProjections,
} from "./task-cache";
import { taskKeys } from "./task-keys";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01a04e0f-2e8a-7000-ae0a-989d784c0287",
    key: "ML-000001",
    workspaceId: "01a04e0f-2e8a-7000-ae0a-989d784c0288",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: "Prepare research presentation",
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    dateWarnings: [],
    reminderOffsetMinutes: null,
    parentTaskId: null,
    recurrence: null,
    seriesId: null,
    fields: {},
    rank: "aa",
    isCompleted: false,
    completedAt: null,
    version: 1,
    tags: [],
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    relations: [],
    blocked: null,
    isBlocked: false,
    ...overrides,
  };
}

const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(value);
  return value;
}
afterEach(() => clients.splice(0).forEach((value) => value.clear()));
const DAY = "2026-09-12";

function today(tasks: TaskDto[]): TodayViewResponse {
  return {
    data: {
      date: DAY,
      sections: [
        {
          id: "due_today",
          tasks: tasks.map((task) => ({ task, reasons: ["due_today"] })),
        },
      ],
      review: null,
    },
  };
}
function upcoming(tasks: TaskDto[]): UpcomingViewResponse {
  return {
    data: {
      from: DAY,
      horizon: "14",
      groups: [{ date: "2026-09-13", tasks }],
      truncated: false,
    },
  };
}

describe("task projection cache", () => {
  it.each(["today", "upcoming"])(
    "completes a child held only in %s exactly once on its cached parent",
    (view) => {
      const value = client();
      const parent = task({
        id: "parent",
        subtaskProgress: { completed: 0, total: 2 },
      });
      const child = task({
        id: "child",
        parentTaskId: parent.id,
        dueDate: view === "today" ? DAY : "2026-09-13",
      });
      value.setQueryData(taskKeys.detail(parent.id), parent);
      value.setQueryData(
        ["views", view, "fixture"],
        view === "today" ? today([child]) : upcoming([child]),
      );
      const optimistic = {
        ...child,
        isCompleted: true,
        completedAt: "2026-09-12T12:00:00Z",
      };
      patchTaskEverywhere(value, optimistic);
      expect(
        value.getQueryData<TaskDto>(taskKeys.detail(parent.id))?.subtaskProgress,
      ).toEqual({ completed: 1, total: 2 });
      // The child has left its only visible projection; absence must not mean creation.
      patchTaskEverywhere(
        value,
        { ...optimistic, version: 2 },
        { previous: optimistic },
      );
      expect(
        value.getQueryData<TaskDto>(taskKeys.detail(parent.id))?.subtaskProgress,
      ).toEqual({ completed: 1, total: 2 });
      patchTaskEverywhere(value, { ...optimistic, version: 2 });
      expect(
        value.getQueryData<TaskDto>(taskKeys.detail(parent.id))?.subtaskProgress,
      ).toEqual({ completed: 1, total: 2 });
    },
  );

  it("reads, patches and rolls back the same Today/review, Upcoming, board and paginated search entries", () => {
    const value = client();
    const original = task({ dueDate: "2026-09-13" });
    const entries: readonly (readonly [QueryKey, unknown])[] = [
      [
        ["views", "today", "current"],
        {
          data: {
            date: DAY,
            sections: [],
            review: { date: "2026-09-11", tasks: [original] },
          },
        } satisfies TodayViewResponse,
      ],
      [["views", "upcoming", "14"], upcoming([original])],
      [
        ["views", "board", {}],
        {
          data: {
            source: "filters",
            columnsBy: "category",
            swimlaneBy: "none",
            columns: [],
            lanes: [],
            projects: [],
            tasks: [original],
            placements: [],
          },
          page: { hasMore: false, truncated: false },
        } satisfies BoardViewResponse,
      ],
      [
        ["search", "research", {}, 20],
        {
          pages: [
            {
              data: {
                tasks: [
                  {
                    task: original,
                    matches: { title: [{ start: 8, end: 16 }], description: [] },
                  },
                ],
                projects: [],
              },
              page: { nextCursor: null, hasMore: false },
            },
          ],
          pageParams: [""],
        } satisfies InfiniteData<SearchResponse>,
      ],
    ];
    for (const [key, data] of entries) value.setQueryData(key, data);
    const snapshot = snapshotTaskProjections(value);
    patchTaskEverywhere(value, { ...original, title: "Changed", version: 2 });
    expect(cachedTasks(value)).toEqual([
      expect.objectContaining({ title: "Changed", version: 2 }),
    ]);
    for (const [key] of entries)
      expect(JSON.stringify(value.getQueryData(key))).toContain('"title":"Changed"');
    expect(
      value.getQueryData<InfiniteData<SearchResponse>>(entries[3]![0])?.pages[0]?.data
        .tasks[0]?.matches.title,
    ).toEqual([]);
    restoreTaskProjections(value, snapshot);
    for (const [key, data] of entries) expect(value.getQueryData(key)).toEqual(data);
  });

  it("invalidates every task projection including inactive details, preserving deleted confirmations and unrelated settings", () => {
    const value = client();
    const keys: QueryKey[] = [
      taskKeys.list({}),
      taskKeys.detail("live"),
      ["projects", "board", "p1"],
      ["views", "board", {}],
      ["views", "today", "current"],
      ["views", "upcoming", "14"],
      ["views", "calendar", DAY, DAY],
      ["activity", "task", "t1"],
      ["flow", "project", "p1"],
      ["search", "term"],
      ["workspace", "me"],
    ];
    for (const key of keys) value.setQueryData(key, task());
    const deletedKey = taskKeys.detail("deleted");
    value.setQueryData(deletedKey, task({ deletedAt: "2026-09-12T12:00:00Z" }));
    value.setQueryData(["webhooks", "list", 100], []);
    invalidateTaskProjections(value);
    for (const key of keys) {
      expect(isTaskProjection(key, value.getQueryData(key))).toBe(true);
      expect(value.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(value.getQueryState(deletedKey)?.isInvalidated).toBe(false);
    expect(value.getQueryState(["webhooks", "list", 100])?.isInvalidated).toBe(false);
  });

  it("cancels every in-flight task projection before an optimistic write", async () => {
    const value = client();
    const keys: QueryKey[] = [
      ["tasks", "detail", "t1"],
      ["views", "today", "current"],
      ["views", "upcoming", "14"],
      ["views", "board", {}],
      ["search", "term"],
    ];
    const aborted: QueryKey[] = [];
    const requests = keys.map((key) =>
      value
        .fetchQuery({
          queryKey: key,
          queryFn: ({ signal }) =>
            new Promise((_, reject) =>
              signal.addEventListener("abort", () => {
                aborted.push(key);
                reject(new Error("cancelled"));
              }),
            ),
        })
        .catch(() => undefined),
    );
    await cancelTaskProjections(value);
    await Promise.all(requests);
    expect(aborted).toEqual(keys);
  });
});
