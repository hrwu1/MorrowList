import { fixedClock, toPlainDate, toPlainTime } from "@morrowlist/domain";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  buildTask,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
} from "../testing/index.js";

import { CalDavPreconditionError, parseEvent } from "./parse.js";
import { CalDavService } from "./service.js";
import { decodeSyncToken, encodeSyncToken } from "./sync.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const TZ = "America/New_York";

const vcalendar = (event: string, extra = "") =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//macOS 26.5//EN",
    extra,
    "BEGIN:VEVENT",
    event,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .filter((line) => line !== "")
    .join("\r\n") + "\r\n";

const allDay = vcalendar(
  "UID:client-1\r\nSUMMARY:Buy milk\r\nDTSTART;VALUE=DATE:20260918\r\nDTEND;VALUE=DATE:20260919\r\nLOCATION:Shop",
);
const timedNy = vcalendar(
  "UID:client-2\r\nSUMMARY:Call\r\nDESCRIPTION:Agenda\\nitems\r\nDTSTART;TZID=America/New_York:20260918T143000\r\nDTEND;TZID=America/New_York:20260918T153000\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM",
);

function fixture() {
  const unitOfWork = createInMemoryUnitOfWork(emptyData());
  const seeded = seedWorkspace(unitOfWork.data, { workspace: { timezone: TZ } });
  const taskService = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "secret",
  });
  const service = new CalDavService({
    unitOfWork,
    taskService,
    appUrl: "https://tasks.example",
    clock: fixedClock(NOW),
  });
  const ws = seeded.workspace.id;
  const ctx = seeded.context;
  return { unitOfWork, seeded, taskService, service, ws, ctx };
}
const event = (ics: string) =>
  new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent("vevent")!;

describe("parseEvent", () => {
  it("reads an all-day event and keeps unmodelled properties", () => {
    const parsed = parseEvent(allDay, TZ);
    expect(parsed).toMatchObject({
      uid: "client-1",
      title: "Buy milk",
      descriptionMd: null,
      dueDate: "2026-09-18",
      dueTime: null,
      dueTimezone: null,
      reminderOffsetMinutes: null,
    });
    expect(parsed.properties).toEqual([["location", {}, "text", "Shop"]]);
  });
  it("reads a zoned time, its alarm, and the block length as a duration", () => {
    const parsed = parseEvent(timedNy, TZ);
    expect(parsed).toMatchObject({
      title: "Call",
      descriptionMd: "Agenda\nitems",
      dueDate: "2026-09-18",
      dueTime: "14:30",
      dueTimezone: "America/New_York",
      reminderOffsetMinutes: 15,
    });
    expect(parsed.properties).toEqual([["duration", {}, "duration", "PT1H"]]);
  });
  it("anchors UTC and floating times in the workspace zone", () => {
    const utc = parseEvent(
      vcalendar("UID:u\r\nSUMMARY:UTC\r\nDTSTART:20260918T183000Z"),
      TZ,
    );
    expect(utc).toMatchObject({
      dueDate: "2026-09-18",
      dueTime: "14:30",
      dueTimezone: TZ,
    });
    const floating = parseEvent(
      vcalendar("UID:f\r\nSUMMARY:Float\r\nDTSTART:20260918T090000"),
      TZ,
    );
    expect(floating).toMatchObject({
      dueDate: "2026-09-18",
      dueTime: "09:00",
      dueTimezone: TZ,
    });
  });
  it("rejects what a task cannot represent with a named precondition", () => {
    const cases: [string, string][] = [
      [
        "UID:r\r\nSUMMARY:Weekly\r\nDTSTART;VALUE=DATE:20260918\r\nRRULE:FREQ=WEEKLY",
        "supported-calendar-data",
      ],
      [
        "UID:a\r\nSUMMARY:Meet\r\nDTSTART:20260918T090000Z\r\nATTENDEE:mailto:x@example.com",
        "supported-calendar-data",
      ],
      ["UID:n\r\nDTSTART;VALUE=DATE:20260918", "valid-calendar-object-resource"],
      ["UID:s\r\nSUMMARY:No start", "valid-calendar-object-resource"],
    ];
    for (const [body, precondition] of cases) {
      let caught: unknown;
      try {
        parseEvent(vcalendar(body), TZ);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CalDavPreconditionError);
      expect((caught as CalDavPreconditionError).precondition).toBe(precondition);
    }
    expect(() => parseEvent("not a calendar", TZ)).toThrow(CalDavPreconditionError);
    expect(() =>
      parseEvent(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:t\r\nSUMMARY:Todo\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
        TZ,
      ),
    ).toThrow(/exactly one VEVENT/);
  });
});

describe("sync tokens", () => {
  it("round-trips and rejects foreign tokens", () => {
    const stamp = { latest: new Date("2026-09-16T10:00:00.000Z"), count: 3 };
    expect(decodeSyncToken(encodeSyncToken(stamp))).toEqual(stamp);
    expect(decodeSyncToken(encodeSyncToken({ latest: null, count: 0 }))).toEqual({
      latest: null,
      count: 0,
    });
    expect(decodeSyncToken("http://example/sync/1")).toBeNull();
  });
});

describe("CalDavService", () => {
  it("lists a calendar per workspace with a ctag that follows task changes", async () => {
    const { service, ctx, ws, taskService } = fixture();
    const before = await service.listCalendars(ctx);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ workspaceId: ws, timezone: TZ });
    await taskService.create(ctx, { workspaceId: ws, title: "New" });
    const after = await service.calendar(ctx, ws);
    expect(after.ctag).not.toBe(before[0]!.ctag);
  });

  it("creates a task from a client PUT and serves it back under the client's name", async () => {
    const { service, ctx, ws, unitOfWork } = fixture();
    const created = await service.put(ctx, ws, "ABC-1", timedNy);
    expect(created.created).toBe(true);
    expect(created.etag).toBe('"1"');
    const task = [...unitOfWork.data.tasks.values()][0]!;
    expect(task).toMatchObject({
      title: "Call",
      descriptionMd: "Agenda\nitems",
      dueDate: "2026-09-18",
      dueTime: "14:30",
      dueTimezone: "America/New_York",
      reminderOffsetMinutes: 15,
    });
    const listed = await service.listResources(ctx, ws);
    expect(listed).toEqual([
      { path: "ABC-1", etag: '"1"', taskId: task.id, resource: "task" },
    ]);
    // The task id is not a second address for a client-named resource.
    expect(await service.getResource(ctx, ws, task.id)).toBeNull();
    const body = (await service.getResource(ctx, ws, "ABC-1"))!;
    const parsed = event(body.ics);
    expect(parsed.getFirstPropertyValue("uid")).toBe("client-2");
    expect(String(parsed.getFirstPropertyValue("dtstart"))).toBe(
      "2026-09-18T18:30:00Z",
    );
    expect(String(parsed.getFirstPropertyValue("duration"))).toBe("PT1H");
    expect(
      parsed
        .getFirstSubcomponent("valarm")!
        .getFirstPropertyValue("trigger")!
        .toString(),
    ).toBe("-PT15M");
  });

  it("updates through If-Match, refuses stale versions and duplicate UIDs", async () => {
    const { service, ctx, ws, unitOfWork } = fixture();
    await service.put(ctx, ws, "ABC-1", allDay);
    await expect(
      service.put(ctx, ws, "ABC-1", allDay, { expectedVersion: 7 }),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });
    await expect(
      service.put(ctx, ws, "ABC-1", allDay, { mustNotExist: true }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(service.put(ctx, ws, "other-path", allDay)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { precondition: "no-uid-conflict", path: "ABC-1" },
    });
    const moved = allDay
      .replace("20260918", "20260920")
      .replace("20260919", "20260921");
    const updated = await service.put(ctx, ws, "ABC-1", moved, { expectedVersion: 1 });
    expect(updated).toEqual({ path: "ABC-1", etag: '"2"', created: false });
    const task = [...unitOfWork.data.tasks.values()][0]!;
    expect(task.dueDate).toBe("2026-09-20");
    expect(task.dueTime).toBeNull();
  });

  it("serves MorrowList-made tasks under their id, with a deadline entry, and edits both", async () => {
    const { service, ctx, ws, seeded, unitOfWork } = fixture();
    const task = buildTask(seeded, unitOfWork.data, {
      title: "Report",
      statusId: seeded.statuses[0]!.id,
      dueDate: toPlainDate("2026-09-18"),
      deadline: toPlainDate("2026-09-20"),
      deadlineTime: toPlainTime("17:00"),
    });
    const listed = await service.listResources(ctx, ws);
    expect(listed.map((e) => e.path)).toEqual([task.id, `${task.id}-deadline`]);
    const deadline = (await service.getResource(ctx, ws, `${task.id}-deadline`))!;
    expect(event(deadline.ics).getFirstPropertyValue("summary")).toBe(
      "Deadline: Report",
    );
    const movedDeadline = vcalendar(
      `UID:${task.id}-deadline@morrowlist\r\nSUMMARY:Deadline: Report\r\nDTSTART;TZID=${TZ}:20260922T090000`,
    );
    await service.put(ctx, ws, `${task.id}-deadline`, movedDeadline);
    expect(unitOfWork.data.tasks.get(task.id)).toMatchObject({
      deadline: "2026-09-22",
      deadlineTime: "09:00",
      title: "Report",
    });
    const renamed = vcalendar(
      `UID:${task.id}@morrowlist\r\nSUMMARY:Report v2\r\nDTSTART;VALUE=DATE:20260919`,
    );
    await service.put(ctx, ws, task.id, renamed);
    expect(unitOfWork.data.tasks.get(task.id)).toMatchObject({
      title: "Report v2",
      dueDate: "2026-09-19",
    });
    expect((await service.getResource(ctx, ws, task.id))!.etag).toBe('"3"');
    expect(await service.delete(ctx, ws, `${task.id}-deadline`)).toBe(true);
    expect(unitOfWork.data.tasks.get(task.id)!.deadline).toBeNull();
    expect(await service.getResource(ctx, ws, `${task.id}-deadline`)).toBeNull();
  });

  it("reports changes and removals since a token, and trashes on delete", async () => {
    const { service, ctx, ws, unitOfWork } = fixture();
    const initial = await service.changesSince(ctx, ws, "");
    expect(initial).toMatchObject({ changed: [], removed: [], truncated: false });
    await service.put(ctx, ws, "ABC-1", allDay);
    const first = (await service.changesSince(ctx, ws, initial!.syncToken))!;
    expect(first.changed.map((c) => c.path)).toEqual(["ABC-1"]);
    expect(first.removed).toEqual([]);
    expect(await service.delete(ctx, ws, "ABC-1")).toBe(true);
    const task = [...unitOfWork.data.tasks.values()][0]!;
    expect(task.deletedAt).not.toBeNull();
    const second = (await service.changesSince(ctx, ws, first.syncToken))!;
    expect(second.changed).toEqual([]);
    expect(second.removed).toContain("ABC-1");
    expect(await service.getResource(ctx, ws, "ABC-1")).toBeNull();
    expect(await service.delete(ctx, ws, "ABC-1")).toBe(false);
    expect(await service.changesSince(ctx, ws, "bogus")).toBeNull();
    await expect(service.put(ctx, ws, "ABC-1", allDay)).rejects.toMatchObject({
      code: "AUTH_FORBIDDEN",
    });
  });

  it("refuses workspaces the caller cannot reach", async () => {
    const { service, ctx, ws } = fixture();
    await expect(
      service.listResources({ ...ctx, workspaceIds: [] }, ws),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
});
