import type { NotificationDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  patchNotificationInList,
  reminderLabel,
  unreadBadge,
} from "./notification-view";

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000001",
    workspaceId: "01a04e0f-0000-7000-8000-000000000002",
    kind: "reminder",
    taskId: "01a04e0f-0000-7000-8000-000000000003",
    title: "Reminder: Call the bank",
    body: "ML-1 is due 2026-09-03 at 12:00 (UTC).",
    readAt: null,
    createdAt: "2026-09-03T09:30:00.000Z",
    ...overrides,
  };
}

describe("patchNotificationInList", () => {
  it("replaces the notification and moves the unread total with its read state", () => {
    const list = {
      data: [notification(), notification({ id: "other" })],
      page: { nextCursor: null, hasMore: false },
      unreadCount: 2,
    };

    const read = patchNotificationInList(
      list,
      notification({ readAt: "2026-09-03T09:31:00.000Z" }),
    );
    expect(read.unreadCount).toBe(1);
    expect(read.data[0]?.readAt).toBe("2026-09-03T09:31:00.000Z");

    // Patching an already-read one again does not double count.
    expect(
      patchNotificationInList(
        read,
        notification({ readAt: "2026-09-03T09:32:00.000Z" }),
      ).unreadCount,
    ).toBe(1);
    // A notification not in this page leaves the page alone.
    expect(patchNotificationInList(list, notification({ id: "missing" }))).toEqual(
      list,
    );
  });
});

describe("unreadBadge and reminderLabel", () => {
  it("renders the bell count and the reminder choices", () => {
    expect(unreadBadge(0)).toBe("");
    expect(unreadBadge(3)).toBe("3");
    expect(unreadBadge(250)).toBe("99+");
    expect(reminderLabel(null)).toBe("No reminder");
    expect(reminderLabel(0)).toBe("At the due time");
    expect(reminderLabel(60)).toBe("1 hour before");
    expect(reminderLabel(45)).toBe("45 minutes before");
  });
});
