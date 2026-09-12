import { expect, it } from "vitest";

import { seedWorkspace } from "../testing/factories.js";
import { createInMemoryUnitOfWork } from "../testing/in-memory.js";

import { IDEMPOTENCY_RETENTION_MS, IdempotencyService } from "./service.js";

it.each([
  { label: "default 24-hour", options: {}, duration: IDEMPOTENCY_RETENTION_MS },
  {
    label: "configured 6-hour",
    options: { retentionMs: 6 * 60 * 60 * 1000 },
    duration: 6 * 60 * 60 * 1000,
  },
])(
  "expires replay results at the $label boundary and permits a new request",
  async ({ options, duration }) => {
    const unitOfWork = createInMemoryUnitOfWork();
    const { context, workspace } = seedWorkspace(unitOfWork.data);
    let now = new Date("2026-09-12T00:00:00Z");
    const service = new IdempotencyService({
      unitOfWork,
      clock: { now: () => now },
      ...options,
    });
    const input = {
      workspaceId: workspace.id,
      scopeHash: "scope",
      keyHash: "key",
      fingerprint: "first",
    };
    let executions = 0;
    const execute = async () => String(++executions);
    expect(await service.execute(context, input, execute)).toBe("1");
    expect(await service.execute(context, input, execute)).toBe("1");
    now = new Date(now.getTime() + duration - 1);
    expect(await service.execute(context, input, execute)).toBe("1");
    now = new Date(now.getTime() + 1);
    expect(
      await service.execute(context, { ...input, fingerprint: "second" }, execute),
    ).toBe("2");
    expect(unitOfWork.data.idempotency.size).toBe(1);
  },
);
