import { expect, it } from "vitest";

import { seedWorkspace } from "../testing/factories.js";
import { createInMemoryUnitOfWork } from "../testing/in-memory.js";

import { IDEMPOTENCY_RETENTION_MS, IdempotencyService } from "./service.js";

it("expires replay results after 24 hours and permits a new request", async () => {
  const unitOfWork = createInMemoryUnitOfWork();
  const { context, workspace } = seedWorkspace(unitOfWork.data);
  let now = new Date("2026-09-12T00:00:00Z");
  const service = new IdempotencyService({ unitOfWork, clock: { now: () => now } });
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
  now = new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS);
  expect(
    await service.execute(context, { ...input, fingerprint: "second" }, execute),
  ).toBe("2");
  expect(unitOfWork.data.idempotency.size).toBe(1);
});
