import type { CreateRuleRequest } from "@morrowlist/contracts";

import type { OutboxEventInput } from "./events.js";
export interface Rule extends CreateRuleRequest {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface RuleRun {
  readonly id: string;
  readonly ruleId: string;
  readonly taskId: string;
  readonly eventKey: string;
  readonly outboxEventId: string | null;
  readonly status: "succeeded" | "skipped" | "failed";
  readonly error: string | null;
  readonly ranAt: Date;
}
export interface RuleCandidate {
  readonly rule: Rule;
  readonly event: OutboxEventInput;
  readonly eventKey: string;
  readonly synthetic: boolean;
}
export interface RuleRepository {
  list(workspaceId: string): Promise<readonly Rule[]>;
  findById(workspaceId: string, id: string): Promise<Rule | null>;
  insert(rule: Rule): Promise<void>;
  update(rule: Rule): Promise<void>;
  delete(workspaceId: string, id: string): Promise<void>;
  candidates(now: Date, limit: number): Promise<readonly RuleCandidate[]>;
  dueCandidates(now: Date, limit: number): Promise<readonly RuleCandidate[]>;
  claim(run: RuleRun): Promise<boolean>;
  finish(run: RuleRun): Promise<void>;
  runs(ruleId: string, limit: number): Promise<readonly RuleRun[]>;
}
