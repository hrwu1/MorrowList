import { updateTaskRequestSchema } from "@morrowlist/contracts";
import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
} from "../testing/index.js";

import { parseInboundEmail, emailDescription } from "./parser.js";
import { InboundEmailService } from "./service.js";
const NOW = new Date("2026-09-07T03:00:00Z");
const secret = "a-test-secret-with-at-least-32-characters";
let uow = createInMemoryUnitOfWork();
let seed = seedWorkspace(uow.data);
let service: InboundEmailService;
beforeEach(() => {
  uow = createInMemoryUnitOfWork(emptyData());
  seed = seedWorkspace(uow.data, { workspace: { timezone: "America/New_York" } });
  service = new InboundEmailService({
    unitOfWork: uow,
    domain: "inbox.example.com",
    webhookSecret: secret,
    addressSecret: secret,
    clock: fixedClock(NOW),
  });
});
async function address() {
  return (await service.rotateAddress(seed.context, seed.workspace.id)).address!;
}
function email(recipient: string) {
  return parseInboundEmail("normalized", {
    messageId: "message-1",
    recipient,
    subject: "Call Sam tomorrow 5pm #Launch @phone",
    text: "Notes\n\nOn Sunday, Sam wrote:\n> Old notes",
    attachmentCount: 2,
  });
}
describe("email capture", () => {
  it("requires ingress authentication and does not accept spoofed From without a recipient capability", async () => {
    expect(() => service.authorize(undefined)).toThrow();
    expect(() => service.authorize(`Bearer ${secret}`)).not.toThrow();
    await expect(
      service.receive("normalized", email("spoof@inbox.example.com"), "request"),
    ).rejects.toThrow("No active capture address");
  });
  it("creates Inbox with parsed local dates, literal unsupported names, body and unchanged event shape", async () => {
    uow.data.notificationPreferences.set(`${seed.userId}:${seed.workspace.id}`, {
      userId: seed.userId,
      workspaceId: seed.workspace.id,
      channels: { inApp: true, email: false, push: false },
      digestTime: null,
      timezone: null,
      defaultOffsetMinutes: 30,
      lastDigestDate: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const result = await service.receive(
      "normalized",
      email(await address()),
      "request",
    );
    const task = uow.data.tasks.get(result.taskId)!;
    expect(task).toMatchObject({
      title: "Call Sam #Launch @phone",
      projectId: null,
      dueDate: "2026-09-07",
      dueTime: "17:00",
      reminderOffsetMinutes: 30,
      dueTimezone: "America/New_York",
      descriptionMd: "Notes\n\n[2 attachment(s) omitted.]",
    });
    const event = uow.data.outbox.at(-1)!;
    expect(event.eventType).toBe("task.created");
    expect(event.payload).toEqual({
      taskId: task.id,
      taskNumber: task.taskNumber,
      projectId: null,
      statusId: null,
      priority: "none",
      parentTaskId: null,
      seriesId: null,
      importedFrom: { source: "email", id: "message-1" },
    });
  });
  it("deduplicates retries but keeps different recipients independent", async () => {
    const inbox = await address();
    const first = await service.receive("normalized", email(inbox), "request");
    expect(await service.receive("normalized", email(inbox), "retry")).toEqual({
      ...first,
      duplicate: true,
    });
    expect(uow.data.tasks.size).toBe(1);
    await expect(service.receive("NORMALIZED", email(inbox), "retry")).rejects.toThrow(
      "Unsupported",
    );
  });
  it("stores long email bodies within the task description edit limit", async () => {
    const result = await service.receive(
      "normalized",
      { ...email(await address()), text: "a".repeat(60_000) },
      "long-email",
    );
    const descriptionMd = uow.data.tasks.get(result.taskId)!.descriptionMd!;
    expect(descriptionMd).toHaveLength(50_000);
    expect(descriptionMd).toContain(
      "[Email body truncated to fit the task description.]",
    );
    expect(descriptionMd).toMatch(/\[2 attachment\(s\) omitted\.\]$/);
    expect(updateTaskRequestSchema.safeParse({ descriptionMd }).success).toBe(true);
  });
  it("stores only digests and rotates atomically without secret event content", async () => {
    const old = await address();
    expect(JSON.stringify([...uow.data.inboundAddresses.values()])).not.toContain(
      old.split("@")[0],
    );
    expect(JSON.stringify(uow.data.outbox)).not.toContain(old.split("@")[0]);
    uow.failNextCommit();
    await expect(address()).rejects.toThrow();
    expect((await service.getAddress(seed.context, seed.workspace.id)).address).toBe(
      old,
    );
    const current = await address();
    expect(current).not.toBe(old);
    await expect(
      service.receive("normalized", email(old), "request"),
    ).rejects.toThrow();
  });
  it("rolls back receipt, task, activity and outbox together", async () => {
    const inbox = await address();
    const before = uow.data.outbox.length;
    uow.failNextCommit();
    await expect(
      service.receive("normalized", email(inbox), "request"),
    ).rejects.toThrow();
    expect(uow.data.tasks.size).toBe(0);
    expect(uow.data.inboundReceipts.size).toBe(0);
    expect(uow.data.outbox).toHaveLength(before);
    expect(uow.data.activity).toHaveLength(before);
  });
  it("checks current membership and rejects API actors and other workspaces", async () => {
    const inbox = await address();
    await expect(
      service.getAddress({ ...seed.context, actorKind: "agent" }, seed.workspace.id),
    ).rejects.toThrow();
    await expect(
      service.getAddress({ ...seed.context, workspaceIds: [] }, seed.workspace.id),
    ).rejects.toThrow();
    uow.data.memberships = [];
    await expect(
      service.receive("normalized", email(inbox), "request"),
    ).rejects.toThrow("current workspace writer");
  });
});
describe("provider normalization", () => {
  const recipient = "a".repeat(64) + "@inbox.example.com";
  it.each([
    ["attachment notes", { text: "a".repeat(50_000), attachmentCount: 1 }],
    ["escaping expansion", { text: "<".repeat(20_000) }],
    ["HTML bodies", { html: `<p>${"Body".repeat(20_000)}</p>` }],
    ["Unicode boundaries", { text: "😀".repeat(30_000) }],
  ] as const)("bounds sanitized descriptions and notices for %s", (_name, body) => {
    const descriptionMd = emailDescription(
      parseInboundEmail("normalized", {
        messageId: "long-message",
        recipient,
        ...body,
      }),
    )!;
    expect(descriptionMd.length).toBeLessThanOrEqual(50_000);
    expect(descriptionMd).toContain(
      "[Email body truncated to fit the task description.]",
    );
    expect(descriptionMd.isWellFormed()).toBe(true);
    expect(updateTaskRequestSchema.safeParse({ descriptionMd }).success).toBe(true);
  });
  it("preserves a body exactly at the description limit without a truncation notice", () => {
    const text = "a".repeat(50_000);
    expect(
      emailDescription(
        parseInboundEmail("normalized", {
          messageId: "exact-limit",
          recipient,
          text,
        }),
      ),
    ).toBe(text);
  });
  it("reads Postmark and strips HTML, scripts and quoted replies", () => {
    const message = parseInboundEmail("postmark", {
      MessageID: "pm-1",
      To: `Capture <${recipient}>`,
      From: "Sam",
      Subject: "HTML",
      HtmlBody: "<p>Hi &amp; hello</p><script>alert(1)</script><div>Body</div>",
      Attachments: [{}],
    });
    expect(message.recipient).toBe(recipient);
    expect(emailDescription(message)).toBe(
      "Hi & hello\nBody\n\n[1 attachment(s) omitted.]",
    );
  });
  it("reads Mailgun forms and decoded SES relays, and rejects raw SNS without extracted MIME", () => {
    expect(
      parseInboundEmail("mailgun", {
        "Message-Id": "mg-1",
        recipient,
        "body-plain": "hello",
        "attachment-count": "2",
      }),
    ).toMatchObject({ text: "hello", attachmentCount: 2 });
    const ses = {
      mail: {
        messageId: "ses-1",
        destination: [recipient],
        commonHeaders: { subject: "SES" },
      },
      text: "body",
    };
    expect(parseInboundEmail("ses", ses)).toMatchObject({
      subject: "SES",
      text: "body",
    });
    expect(() => parseInboundEmail("ses", { ...ses, text: undefined })).toThrow(
      "extract MIME",
    );
    expect(() =>
      parseInboundEmail("normalized", {
        messageId: "id",
        recipient,
        text: "x".repeat(200001),
      }),
    ).toThrow("Invalid inbound");
  });
});
