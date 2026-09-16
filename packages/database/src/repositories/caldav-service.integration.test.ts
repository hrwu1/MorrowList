import {
  CalDavService,
  TaskService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * CalDAV writes against real PostgreSQL: the task mutation, the activity row, the outbox
 * row, and the caldav_objects row commit together; a version conflict rolls all of them
 * back; sync-collection sees a trash as a removal.
 */

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;
let taskService: TaskService;
let service: CalDavService;

const vevent = (uid: string, summary: string, start: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\n${start}\r\nLOCATION:Desk\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

beforeAll(async () => {
  handle = await setupTestDatabase();
});
afterAll(async () => {
  await teardownTestDatabase();
});
beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  const userId = uuidv7();
  const result = await bootstrapUser(
    { unitOfWork },
    { userId, email: "dav@example.com", displayName: "Dav", timezone: "Europe/Berlin" },
  );
  workspaceId = result.workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Dav",
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "caldav-integration",
  };
  taskService = new TaskService({ unitOfWork, cursorSecret: "integration" });
  service = new CalDavService({
    unitOfWork,
    taskService,
    appUrl: "https://tasks.example",
  });
});

const count = async (sql: string, params: unknown[] = []) =>
  Number((await handle.pool.query(sql, params)).rows[0]!.n);

describe("CalDAV PostgreSQL writes", () => {
  it("commits task, activity, outbox and object rows together and reads them back", async () => {
    const created = await service.put(
      context,
      workspaceId,
      "ABC-1",
      vevent(
        "ABC-1",
        "Call",
        "DTSTART;TZID=Europe/Berlin:20260918T143000\r\nDTEND;TZID=Europe/Berlin:20260918T150000",
      ),
    );
    expect(created).toEqual({ path: "ABC-1", etag: '"1"', created: true });
    const task = (
      await handle.pool.query(
        "select id, title, due_date::text as due_date, due_time::text as due_time, due_timezone from tasks",
      )
    ).rows[0]!;
    expect(task).toMatchObject({
      title: "Call",
      due_date: "2026-09-18",
      due_time: "14:30:00",
      due_timezone: "Europe/Berlin",
    });
    expect(await count("select count(*) as n from caldav_objects")).toBe(1);
    expect(
      await count("select count(*) as n from activity_events where aggregate_id = $1", [
        task.id,
      ]),
    ).toBeGreaterThan(0);
    expect(
      await count("select count(*) as n from outbox_events where aggregate_id = $1", [
        task.id,
      ]),
    ).toBeGreaterThan(0);
    const body = (await service.getResource(context, workspaceId, "ABC-1"))!;
    expect(body.ics).toContain("UID:ABC-1");
    expect(body.ics).toContain("LOCATION:Desk");
    expect(body.ics).toContain("DURATION:PT30M");
    expect(body.ics).toContain("DTSTART:20260918T123000Z");
  });

  it("rolls back a stale write entirely and keeps the client path after a rename", async () => {
    await service.put(
      context,
      workspaceId,
      "ABC-1",
      vevent("ABC-1", "First", "DTSTART;VALUE=DATE:20260918"),
    );
    const before = await count("select count(*) as n from activity_events");
    await expect(
      service.put(
        context,
        workspaceId,
        "ABC-1",
        vevent("ABC-1", "Stale", "DTSTART;VALUE=DATE:20260919"),
        {
          expectedVersion: 5,
        },
      ),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });
    expect(await count("select count(*) as n from activity_events")).toBe(before);
    expect((await handle.pool.query("select title from tasks")).rows[0]!.title).toBe(
      "First",
    );
    const taskId = (await handle.pool.query("select id from tasks")).rows[0]!
      .id as string;
    await taskService.update(context, workspaceId, taskId, { title: "Renamed in app" });
    const listed = await service.listResources(context, workspaceId);
    expect(listed).toEqual([{ path: "ABC-1", etag: '"2"', taskId, resource: "task" }]);
  });

  it("reports a trash as a removal to a client holding the previous token", async () => {
    const initial = (await service.changesSince(context, workspaceId, ""))!;
    await service.put(
      context,
      workspaceId,
      "ABC-1",
      vevent("ABC-1", "Gone soon", "DTSTART;VALUE=DATE:20260918"),
    );
    const first = (await service.changesSince(
      context,
      workspaceId,
      initial.syncToken,
    ))!;
    expect(first.changed.map((c) => c.path)).toEqual(["ABC-1"]);
    // A later instant so the second token can move past the first change.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await service.delete(context, workspaceId, "ABC-1")).toBe(true);
    const second = (await service.changesSince(context, workspaceId, first.syncToken))!;
    expect(second.changed).toEqual([]);
    expect(second.removed).toContain("ABC-1");
    expect(second.syncToken).not.toBe(first.syncToken);
    expect(
      (await handle.pool.query("select deleted_at from tasks")).rows[0]!.deleted_at,
    ).not.toBeNull();
    // The path stays reserved so other clients also learn of the removal by that name.
    expect(await count("select count(*) as n from caldav_objects")).toBe(1);
  });
});
