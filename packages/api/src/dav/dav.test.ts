import {
  CalDavService,
  TaskService,
  bootstrapUser,
  type ActorContext,
} from "@morrowlist/application";
import type { AuthPort, AuthenticatedUser } from "@morrowlist/auth";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { silentLogger } from "@morrowlist/observability";
import {
  createInMemoryUnitOfWork,
  emptyData,
  type InMemoryUnitOfWork,
} from "@morrowlist/testkit";
import { beforeEach, describe, expect, it } from "vitest";

import { createDavApp } from "./app.js";
import { parseXml, childrenOf, childOf, DAV, CALDAV, XmlError } from "./xml.js";

/**
 * The CalDAV app over in-memory ports: discovery, listings, reports, writes, and the
 * status codes Calendar.app depends on. Basic credentials are translated to a bearer
 * token, which the fake auth port accepts only as "secret".
 */

const NOW = new Date("2026-09-16T12:00:00.000Z");
const EMAIL = "alex@example.com";
const BASIC = `Basic ${Buffer.from(`${EMAIL}:secret`).toString("base64")}`;

let unitOfWork: InMemoryUnitOfWork;
let app: ReturnType<typeof createDavApp>;
let taskService: TaskService;
let context: ActorContext;
let workspaceId: string;
let calendar: string;

const event = (uid: string, summary: string, start = "DTSTART;VALUE=DATE:20260918") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\n${start}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

function dav(
  path: string,
  method: string,
  init: { body?: string; headers?: Record<string, string>; auth?: string | null } = {},
) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.auth !== null) headers.Authorization = init.auth ?? BASIC;
  return app.request(`http://localhost${path}`, {
    method,
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}
const propfind = (path: string, depth: string, props: string) =>
  dav(path, "PROPFIND", {
    headers: { Depth: depth, "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/"><D:prop>${props}</D:prop></D:propfind>`,
  });
const report = (path: string, body: string) =>
  dav(path, "REPORT", {
    headers: { Depth: "1", "Content-Type": "application/xml" },
    body,
  });

/** Multistatus responses as `{ href, status, props }` with found property text by local name. */
async function responses(res: Response) {
  expect(res.status).toBe(207);
  const root = parseXml(await res.text());
  return childrenOf(root, DAV, "response").map((r) => {
    const found: Record<string, string> = {};
    const missing: string[] = [];
    for (const propstat of childrenOf(r, DAV, "propstat")) {
      const ok = childOf(propstat, DAV, "status")!.text.includes("200");
      for (const prop of childOf(propstat, DAV, "prop")!.children)
        if (ok)
          found[prop.name] =
            prop.text ||
            prop.children.map((c) => c.name + (c.text ? `:${c.text}` : "")).join(",");
        else missing.push(prop.name);
    }
    return {
      href: childOf(r, DAV, "href")!.text,
      status: childOf(r, DAV, "status")?.text ?? null,
      found,
      missing,
      syncToken: childOf(root, DAV, "sync-token")?.text ?? null,
    };
  });
}

beforeEach(async () => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  const userId = uuidv7();
  const result = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: EMAIL,
      displayName: "Alex",
      timezone: "Europe/Berlin",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = result.workspace.id;
  calendar = `/dav/calendars/${workspaceId}/`;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Alex",
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "dav-test",
  };
  const user: AuthenticatedUser = { id: userId, email: EMAIL, name: "Alex" };
  const auth: AuthPort = {
    resolveUser: async (headers) =>
      headers.get("authorization") === "Bearer secret" ? user : null,
    handleRequest: async () => new Response("not used", { status: 404 }),
  };
  taskService = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "s",
  });
  app = createDavApp({
    auth,
    unitOfWork,
    logger: silentLogger,
    calDavService: new CalDavService({
      unitOfWork,
      taskService,
      appUrl: "https://tasks.example",
      clock: fixedClock(NOW),
    }),
  });
});

describe("CalDAV auth and discovery", () => {
  it("challenges without credentials and refuses a foreign username", async () => {
    const anonymous = await dav("/dav/", "PROPFIND", { auth: null });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("WWW-Authenticate")).toContain("Basic");
    const wrongUser = await dav("/dav/", "PROPFIND", {
      auth: `Basic ${Buffer.from("someone@example.com:secret").toString("base64")}`,
    });
    expect(wrongUser.status).toBe(401);
    const bearer = await dav("/dav/", "PROPFIND", {
      auth: "Bearer secret",
      headers: { Depth: "0" },
    });
    expect(bearer.status).toBe(207);
    const options = await dav("/dav/", "OPTIONS", { auth: null });
    expect(options.headers.get("DAV")).toContain("calendar-access");
    const wellKnown = await dav("/.well-known/caldav", "GET", { auth: null });
    expect(wellKnown.status).toBe(301);
    expect(wellKnown.headers.get("Location")).toBe("/dav/");
  });

  it("walks root → principal → home → calendar with CalDAV properties", async () => {
    const [root] = await responses(
      await propfind(
        "/dav/",
        "0",
        "<D:current-user-principal/><D:resourcetype/><D:unknown-prop/>",
      ),
    );
    expect(root!.href).toBe("/dav/");
    expect(root!.found["current-user-principal"]).toBe("href:/dav/principals/me/");
    expect(root!.missing).toEqual(["unknown-prop"]);
    const [principal] = await responses(
      await propfind(
        "/dav/principals/me/",
        "0",
        "<C:calendar-home-set/><C:calendar-user-address-set/><D:displayname/>",
      ),
    );
    expect(principal!.found["calendar-home-set"]).toBe("href:/dav/calendars/");
    expect(principal!.found["calendar-user-address-set"]).toBe(`href:mailto:${EMAIL}`);
    expect(principal!.found.displayname).toBe("Alex");
    const home = await responses(
      await propfind(
        "/dav/calendars/",
        "1",
        "<D:resourcetype/><D:displayname/><CS:getctag/><C:supported-calendar-component-set/><D:sync-token/>",
      ),
    );
    expect(home.map((r) => r.href)).toEqual(["/dav/calendars/", calendar]);
    expect(home[1]!.found.resourcetype).toBe("collection,calendar");
    expect(home[1]!.found["supported-calendar-component-set"]).toBe("comp");
    expect(home[1]!.found.getctag).toMatch(/^ml-\d+-\d+$/);
    expect(home[1]!.found["sync-token"]).toBe(
      `urn:morrowlist:sync:${home[1]!.found.getctag}`,
    );
    expect((await propfind("/dav/nowhere/", "0", "")).status).toBe(404);
    expect((await dav("/dav/", "PROPFIND", { body: "<D:propfind" })).status).toBe(400);
  });
});

describe("CalDAV objects", () => {
  it("creates, lists, reads, updates with If-Match, and refuses stale writes", async () => {
    const created = await dav(`${calendar}ABC-1.ics`, "PUT", {
      body: event("ABC-1", "Buy milk"),
      headers: { "If-None-Match": "*" },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("ETag")).toBe('"1"');
    const tasks = [...unitOfWork.data.tasks.values()];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Buy milk", dueDate: "2026-09-18" });

    const listing = await responses(
      await propfind(calendar, "1", "<D:getetag/><D:getcontenttype/><D:resourcetype/>"),
    );
    expect(listing.map((r) => r.href)).toEqual([calendar, `${calendar}ABC-1.ics`]);
    expect(listing[1]!.found.getetag).toBe('"1"');
    expect(listing[1]!.found.getcontenttype).toContain("text/calendar");

    const got = await dav(`${calendar}ABC-1.ics`, "GET");
    expect(got.status).toBe(200);
    expect(got.headers.get("ETag")).toBe('"1"');
    expect(await got.text()).toContain("UID:ABC-1");
    expect((await dav(`${calendar}ABC-1.ics`, "HEAD")).status).toBe(200);

    expect(
      (
        await dav(`${calendar}ABC-1.ics`, "PUT", {
          body: event("ABC-1", "Stale"),
          headers: { "If-Match": '"9"' },
        })
      ).status,
    ).toBe(412);
    expect(
      (
        await dav(`${calendar}ABC-1.ics`, "PUT", {
          body: event("ABC-1", "Dup"),
          headers: { "If-None-Match": "*" },
        })
      ).status,
    ).toBe(412);
    const updated = await dav(`${calendar}ABC-1.ics`, "PUT", {
      body: event("ABC-1", "Buy oat milk"),
      headers: { "If-Match": '"1"' },
    });
    expect(updated.status).toBe(204);
    expect(updated.headers.get("ETag")).toBe('"2"');
    expect([...unitOfWork.data.tasks.values()][0]!.title).toBe("Buy oat milk");
    expect((await dav(`${calendar}missing.ics`, "GET")).status).toBe(404);
  });

  it("answers preconditions in CalDAV error bodies", async () => {
    const recurring = await dav(`${calendar}R.ics`, "PUT", {
      body: event("R", "Weekly", "DTSTART;VALUE=DATE:20260918\r\nRRULE:FREQ=WEEKLY"),
    });
    expect(recurring.status).toBe(403);
    const error = parseXml(await recurring.text());
    expect(childOf(error, CALDAV, "supported-calendar-data")).not.toBeNull();
    expect(childOf(error, DAV, "responsedescription")!.text).toMatch(/Repeating/);
    expect(unitOfWork.data.tasks.size).toBe(0);
    const garbage = await dav(`${calendar}G.ics`, "PUT", { body: "hello" });
    expect(garbage.status).toBe(403);
    expect(
      childOf(parseXml(await garbage.text()), CALDAV, "valid-calendar-data"),
    ).not.toBeNull();
    await dav(`${calendar}A.ics`, "PUT", { body: event("same-uid", "One") });
    const duplicate = await dav(`${calendar}B.ics`, "PUT", {
      body: event("same-uid", "Two"),
    });
    expect(duplicate.status).toBe(403);
    expect(
      childOf(parseXml(await duplicate.text()), CALDAV, "no-uid-conflict"),
    ).not.toBeNull();
  });

  it("serves multiget, calendar-query by component, sync-collection and deletes", async () => {
    const task = await taskService.create(context, {
      workspaceId,
      title: "Made in MorrowList",
      dueDate: "2026-09-19",
      deadline: "2026-09-21",
    } as never);
    await dav(`${calendar}ABC-1.ics`, "PUT", { body: event("ABC-1", "Buy milk") });

    const query = await responses(
      await report(
        calendar,
        `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"/></C:comp-filter></C:filter></C:calendar-query>`,
      ),
    );
    expect(query.map((r) => r.href).sort()).toEqual(
      [
        `${calendar}${task.id}-deadline.ics`,
        `${calendar}${task.id}.ics`,
        `${calendar}ABC-1.ics`,
      ].sort(),
    );
    expect(query.every((r) => r.found["calendar-data"]?.includes("BEGIN:VEVENT"))).toBe(
      true,
    );
    const todos = await responses(
      await report(
        calendar,
        `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/></C:comp-filter></C:filter></C:calendar-query>`,
      ),
    );
    expect(todos).toEqual([]);

    const multi = await responses(
      await report(
        calendar,
        `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>${calendar}ABC-1.ics</D:href><D:href>${calendar}nope.ics</D:href></C:calendar-multiget>`,
      ),
    );
    expect(multi[0]!.found["calendar-data"]).toContain("SUMMARY:Buy milk");
    expect(multi[1]).toMatchObject({
      href: `${calendar}nope.ics`,
      status: "HTTP/1.1 404 Not Found",
    });

    const initial = await responses(
      await report(
        calendar,
        `<D:sync-collection xmlns:D="DAV:"><D:sync-token/><D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>`,
      ),
    );
    expect(initial).toHaveLength(3);
    const token = initial[0]!.syncToken!;
    expect(token).toMatch(/^urn:morrowlist:sync:ml-/);

    expect((await dav(`${calendar}ABC-1.ics`, "DELETE")).status).toBe(204);
    expect((await dav(`${calendar}ABC-1.ics`, "DELETE")).status).toBe(404);
    const after = await responses(
      await report(
        calendar,
        `<D:sync-collection xmlns:D="DAV:"><D:sync-token>${token}</D:sync-token><D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>`,
      ),
    );
    const removed = after.filter((r) => r.status?.includes("404")).map((r) => r.href);
    expect(removed).toContain(`${calendar}ABC-1.ics`);
    // With a fixed clock every change shares one instant, so the token itself stays put.
    expect(after[0]!.syncToken).toMatch(/^urn:morrowlist:sync:ml-/);
    const bogus = await report(
      calendar,
      `<D:sync-collection xmlns:D="DAV:"><D:sync-token>urn:other:1</D:sync-token><D:prop><D:getetag/></D:prop></D:sync-collection>`,
    );
    expect(bogus.status).toBe(403);
    expect(
      childOf(parseXml(await bogus.text()), DAV, "valid-sync-token"),
    ).not.toBeNull();
  });

  it("refuses metadata and collection changes without breaking the client", async () => {
    const patched = await dav(calendar, "PROPPATCH", {
      body: `<D:propertyupdate xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/"><D:set><D:prop><A:calendar-color>#FF0000</A:calendar-color></D:prop></D:set></D:propertyupdate>`,
    });
    expect(patched.status).toBe(207);
    const propstat = childOf(
      childOf(parseXml(await patched.text()), DAV, "response")!,
      DAV,
      "propstat",
    )!;
    expect(childOf(propstat, DAV, "prop")!.children[0]).toMatchObject({
      name: "calendar-color",
    });
    expect(childOf(propstat, DAV, "status")!.text).toBe("HTTP/1.1 403 Forbidden");
    expect((await dav("/dav/calendars/new/", "MKCALENDAR")).status).toBe(403);
    expect((await dav(calendar, "DELETE")).status).toBe(403);
    expect(
      (
        await dav(`/dav/calendars/${uuidv7()}/`, "PROPFIND", {
          headers: { Depth: "0" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("xml reader", () => {
  it("resolves prefixes, attributes, entities and CDATA, and rejects malformed input", () => {
    const root = parseXml(
      `<?xml version="1.0"?><a:root xmlns:a="urn:a" xmlns="urn:d"><child name="V&amp;E">hi<![CDATA[<raw>]]></child><!-- c --><a:x/></a:root>`,
    );
    expect(root).toMatchObject({ ns: "urn:a", name: "root" });
    expect(root.children[0]).toMatchObject({
      ns: "urn:d",
      name: "child",
      attrs: { name: "V&E" },
      text: "hi<raw>",
    });
    expect(root.children[1]).toMatchObject({ ns: "urn:a", name: "x" });
    for (const bad of ["<a>", "<a></b>", "<p:a/>", "<a/><b/>", "text"])
      expect(() => parseXml(bad)).toThrow(XmlError);
  });
});
