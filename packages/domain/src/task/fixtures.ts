import type { StatusCategory, WorkflowStatus } from "../project/status.js";
import type { ActorRef } from "../shared/actor.js";
import { fixedClock, type Clock } from "../shared/clock.js";

import type { PolicyContext } from "./policies.js";

/** Deterministic fixtures shared by the domain's own tests. */

export const TEST_INSTANT = new Date("2026-08-29T09:00:00.000Z");

export const testActor: ActorRef = { kind: "user", id: "user-1" };

export function testContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const clock: Clock = overrides.clock ?? fixedClock(TEST_INSTANT);
  return { actor: overrides.actor ?? testActor, clock };
}

export function testStatus(overrides: Partial<WorkflowStatus> = {}): WorkflowStatus {
  const category: StatusCategory = overrides.category ?? "ready";
  return {
    id: overrides.id ?? `status-${category}`,
    projectId: overrides.projectId ?? "project-1",
    name: overrides.name ?? category,
    category,
    rank: overrides.rank ?? "a0",
    colorToken: overrides.colorToken ?? "blue",
    wipLimit: overrides.wipLimit ?? null,
    isDefault: overrides.isDefault ?? category === "ready",
    policyMd: overrides.policyMd ?? null,
    archivedAt: overrides.archivedAt ?? null,
    version: overrides.version ?? 1,
  };
}
