import {
  fixedClock,
  toPlainDate,
  toPlainTime,
  toRecurrenceRule,
} from "@morrowlist/domain";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import {
  buildTask,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
} from "../testing/index.js";
import { ViewService } from "../views/service.js";

import { renderCalendar } from "./ics.js";
import { CalendarFeedService } from "./service.js";

function fixture() {
  const unitOfWork = createInMemoryUnitOfWork(emptyData());
  const seeded = seedWorkspace(unitOfWork.data, {
    workspace: { timezone: "America/New_York" },
  });
  const task = buildTask(seeded, unitOfWork.data, {
    title: "Plan",
    statusId: seeded.statuses[0]!.id,
    dueDate: toPlainDate("2026-09-07"),
  });
  const service = new CalendarFeedService({
    unitOfWork,
    signingSecret: "test-secret",
    appUrl: "https://tasks.example",
    clock: fixedClock(new Date("2026-09-07T12:00:00Z")),
  });
  return { unitOfWork, seeded, task, service };
}
const tokenOf = (url: string) => new URL(url).pathname.split("/").at(-1)!.slice(0, -4);
const events = (ics: string) =>
  new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents("vevent");

describe("Calendar feed", () => {
  it("parses all-day dates, stable identity, UTF-8 folds and injection-safe text", () => {
    const { task, seeded } = fixture();
    const title = "计划，\\;".repeat(35) + "\r\nEND:VEVENT\nBEGIN:VEVENT";
    const ics = renderCalendar(
      [{ ...task, title }],
      seeded.workspace,
      "https://tasks.example",
    );
    const parsed = events(ics);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.getFirstPropertyValue("summary")).toBe(
      title.replace(/\r\n/g, "\n"),
    );
    expect(parsed[0]!.getFirstPropertyValue("uid")).toBe(`${task.id}@morrowlist`);
    expect(String(parsed[0]!.getFirstPropertyValue("dtstart"))).toBe("2026-09-07");
    expect(String(parsed[0]!.getFirstPropertyValue("dtend"))).toBe("2026-09-08");
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });
  it("converts timezone/DST correctly and preserves deadlines and timed reminders", () => {
    const { task, seeded } = fixture();
    const ics = renderCalendar(
      [
        {
          ...task,
          dueDate: toPlainDate("2026-03-09"),
          dueTime: toPlainTime("09:00"),
          reminderOffsetMinutes: 30,
          deadline: toPlainDate("2026-03-10"),
          deadlineTime: toPlainTime("17:00"),
        },
      ],
      seeded.workspace,
      "https://tasks.example",
    );
    const parsed = events(ics);
    expect(String(parsed[0]!.getFirstPropertyValue("dtstart"))).toBe(
      "2026-03-09T13:00:00Z",
    );
    expect(String(parsed[1]!.getFirstPropertyValue("dtstart"))).toBe(
      "2026-03-10T21:00:00Z",
    );
    expect(
      String(
        parsed[0]!.getFirstSubcomponent("valarm")!.getFirstPropertyValue("trigger"),
      ),
    ).toBe("-PT30M");
  });
  it("exports only open occurrences and never expands recurrence", () => {
    const { task, seeded } = fixture();
    const result = events(
      renderCalendar(
        [
          { ...task, recurrence: toRecurrenceRule({ freq: "daily" }) },
          { ...task, id: "done", completedAt: new Date() },
          { ...task, id: "trash", deletedAt: new Date() },
        ],
        seeded.workspace,
        "https://tasks.example",
      ),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.hasProperty("rrule")).toBe(false);
  });
  it("rotates, rejects tampering, checks live membership, revokes on the next request, and stores only hashes", async () => {
    const { service, seeded, unitOfWork } = fixture();
    const first = await service.create(seeded.context, seeded.workspace.id);
    expect(await service.feed(tokenOf(first.url))).toContain("BEGIN:VEVENT");
    expect(await service.feed(tokenOf(first.url) + "x")).toBeNull();
    const second = await service.create(seeded.context, seeded.workspace.id);
    expect(await service.feed(tokenOf(first.url))).toBeNull();
    expect(
      JSON.stringify([...unitOfWork.data.calendarFeedTokens.values()]),
    ).not.toContain(tokenOf(second.url));
    expect(JSON.stringify(unitOfWork.data.activity)).not.toContain(tokenOf(second.url));
    const memberships = unitOfWork.data.memberships;
    unitOfWork.data.memberships = [];
    expect(await service.feed(tokenOf(second.url))).toBeNull();
    unitOfWork.data.memberships = memberships;
    await service.revoke(seeded.context, seeded.workspace.id);
    expect(await service.feed(tokenOf(second.url))).toBeNull();
    expect((await service.status(seeded.context, seeded.workspace.id)).active).toBe(
      false,
    );
  });
  it("rolls back credential rotation and activity when the outbox fails", async () => {
    const { seeded, unitOfWork } = fixture();
    const broken = new CalendarFeedService({
      signingSecret: "test",
      appUrl: "https://tasks.example",
      unitOfWork: {
        execute: (fn) =>
          unitOfWork.execute((tx) =>
            fn({
              ...tx,
              outbox: {
                ...tx.outbox,
                enqueue: async () => {
                  throw new Error("outbox unavailable");
                },
              },
            }),
          ),
      },
    });
    await expect(broken.create(seeded.context, seeded.workspace.id)).rejects.toThrow(
      "outbox unavailable",
    );
    expect(unitOfWork.data.calendarFeedTokens.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
  });
  it("does not let read-only credentials mint a broader feed", async () => {
    const { service, seeded } = fixture();
    await expect(
      service.create(
        { ...seeded.context, actorKind: "api_key", scopes: new Set(["tasks:read"]) },
        seeded.workspace.id,
      ),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
  it("queries each date kind once, includes deferred work, isolates workspaces, validates ranges", async () => {
    const { seeded, unitOfWork, task } = fixture();
    unitOfWork.data.tasks.set(task.id, {
      ...task,
      dueDate: null,
      deadline: toPlainDate("2026-09-07"),
      deferUntil: toPlainDate("2026-09-07"),
    });
    const view = new ViewService({ unitOfWork });
    const query = {
      workspaceId: seeded.workspace.id,
      from: "2026-09-01",
      to: "2026-09-30",
    };
    expect(
      (await view.calendar(seeded.context, query)).data.tasks.map((entry) => entry.id),
    ).toEqual([task.id]);
    await expect(
      view.calendar({ ...seeded.context, workspaceIds: [] }, query),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(
      view.calendar(seeded.context, { ...query, to: "2026-08-01" }),
    ).rejects.toThrow();
  });
});
