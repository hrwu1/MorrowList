import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryUnitOfWork,
  emptyData,
  type InMemoryUnitOfWork,
} from "../testing/index.js";

import { bootstrapUser, defaultPrefix, slugify } from "./bootstrap.js";

const NOW = new Date("2026-08-29T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;

function bootstrap(input: Partial<Parameters<typeof bootstrapUser>[1]> = {}) {
  return bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId: uuidv7(),
      email: "alex@example.com",
      timezone: "Europe/Berlin",
      ...input,
    },
  );
}

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
});

describe("bootstrapUser", () => {
  it("creates exactly one personal workspace with an owner membership", async () => {
    // M1 acceptance scenario 1 (spec 35).
    const userId = uuidv7();
    const result = await bootstrap({ userId, displayName: "Alex" });

    expect(result.created).toBe(true);
    expect(unitOfWork.data.workspaces.size).toBe(1);
    expect(unitOfWork.data.memberships).toEqual([
      {
        workspaceId: result.workspace.id,
        userId,
        role: "owner",
        joinedAt: NOW,
      },
    ]);
    // The counter is materialised but unconsumed, so the first task will be number 1.
    expect(unitOfWork.data.counters.get(result.workspace.id)).toBe(1);
  });

  it("is idempotent when the callback is retried", async () => {
    const userId = uuidv7();
    const first = await bootstrap({ userId });
    const second = await bootstrap({ userId });

    expect(second.created).toBe(false);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(unitOfWork.data.workspaces.size).toBe(1);
    expect(unitOfWork.data.memberships).toHaveLength(1);
  });

  it("records a workspace.created activity and outbox event once", async () => {
    const userId = uuidv7();
    await bootstrap({ userId });
    await bootstrap({ userId });

    expect(unitOfWork.data.activity.map((e) => e.eventType)).toEqual([
      "workspace.created",
    ]);
    expect(unitOfWork.data.outbox).toHaveLength(1);
  });

  it("derives a workspace name and task key prefix", async () => {
    const result = await bootstrap({ displayName: "Morrow Team" });

    expect(result.workspace.name).toBe("Morrow Team's Workspace");
    expect(result.workspace.taskKeyPrefix).toBe("MORR");
  });

  it("honours an explicit workspace name and prefix from onboarding", async () => {
    const result = await bootstrap({
      workspaceName: "Research",
      taskKeyPrefix: "RES",
    });

    expect(result.workspace.name).toBe("Research");
    expect(result.workspace.taskKeyPrefix).toBe("RES");
  });

  it("gives two users with the same name distinct slugs", async () => {
    const first = await bootstrap({ userId: uuidv7(), displayName: "Alex" });
    const second = await bootstrap({ userId: uuidv7(), displayName: "Alex" });

    expect(first.workspace.slug).toBe("alex-s-workspace");
    expect(second.workspace.slug).toBe("alex-s-workspace-2");
  });

  it("rolls back the whole bootstrap when the commit fails", async () => {
    unitOfWork.failNextCommit();

    await expect(bootstrap()).rejects.toThrow();

    expect(unitOfWork.data.workspaces.size).toBe(0);
    expect(unitOfWork.data.memberships).toHaveLength(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
  });
});

describe("slugify and defaultPrefix", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Alex's Workspace")).toBe("alex-s-workspace");
    expect(slugify("  Ünïcode  Name ")).toBe("unicode-name");
    expect(slugify("!!!")).toBe("workspace");
  });

  it("falls back to ML when a name has no letters", () => {
    expect(defaultPrefix("123")).toBe("ML");
    expect(defaultPrefix("MorrowList")).toBe("MORR");
  });
});
