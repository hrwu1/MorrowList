import { z } from "zod";

import { prioritySchema, uuidSchema } from "./common.js";

export const ruleTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task.created") }).strict(),
  z.object({ type: z.literal("task.moved") }).strict(),
  z.object({ type: z.literal("task.completed") }).strict(),
  z.object({ type: z.literal("due.today") }).strict(),
  z
    .object({
      type: z.literal("task.updated"),
      field: z
        .enum([
          "title",
          "descriptionMd",
          "priority",
          "dueDate",
          "dueTime",
          "dueTimezone",
          "deferUntil",
          "deadline",
          "deadlineTime",
          "fields",
          "recurrence",
          "reminderOffsetMinutes",
        ])
        .optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("task.tag_added"), tagId: uuidSchema.optional() })
    .strict(),
]);
export const ruleConditionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("project_is"), projectId: uuidSchema.nullable() })
    .strict(),
  z.object({ type: z.literal("priority_is"), priority: prioritySchema }).strict(),
  z.object({ type: z.literal("tag_has"), tagId: uuidSchema }).strict(),
  z
    .object({ type: z.literal("due_within"), days: z.number().int().min(0).max(365) })
    .strict(),
]);
export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_to_day") }).strict(),
  z.object({ type: z.literal("complete") }).strict(),
  z
    .object({
      type: z.literal("move_to"),
      projectId: uuidSchema.nullable(),
      statusId: uuidSchema.nullish(),
    })
    .strict(),
  z.object({ type: z.literal("set_priority"), priority: prioritySchema }).strict(),
  z.object({ type: z.literal("add_tag"), tagId: uuidSchema }).strict(),
  z.object({ type: z.literal("call_webhook"), subscriptionId: uuidSchema }).strict(),
]);
export const createRuleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    trigger: ruleTriggerSchema,
    conditions: z.array(ruleConditionSchema).max(10).default([]),
    actions: z.array(ruleActionSchema).min(1).max(10),
    enabled: z.boolean().default(true),
  })
  .strict();
export const updateRuleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    trigger: ruleTriggerSchema.optional(),
    conditions: z.array(ruleConditionSchema).max(10).optional(),
    actions: z.array(ruleActionSchema).min(1).max(10).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Supply at least one field");
export const ruleSchema = createRuleRequestSchema.extend({
  id: uuidSchema,
  workspaceId: uuidSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ruleResponseSchema = z.object({ data: ruleSchema });
export const ruleListResponseSchema = z.object({ data: z.array(ruleSchema) });
export const ruleRunSchema = z.object({
  id: uuidSchema,
  ruleId: uuidSchema,
  taskId: uuidSchema,
  eventKey: z.string(),
  outboxEventId: uuidSchema.nullable(),
  status: z.enum(["succeeded", "skipped", "failed"]),
  error: z.string().nullable(),
  ranAt: z.iso.datetime(),
});
export const ruleRunsResponseSchema = z.object({ data: z.array(ruleRunSchema) });
export const testRuleRequestSchema = z.object({ taskId: uuidSchema }).strict();
export const testRuleResponseSchema = z.object({
  data: z.object({
    matches: z.boolean(),
    actions: z.array(ruleActionSchema),
    explanation: z.string(),
  }),
});
export type CreateRuleRequest = z.infer<typeof createRuleRequestSchema>;
export type UpdateRuleRequest = z.infer<typeof updateRuleRequestSchema>;
export type RuleDto = z.infer<typeof ruleSchema>;
export type RuleRunDto = z.infer<typeof ruleRunSchema>;
export type RuleTestResult = z.infer<typeof testRuleResponseSchema>["data"];

export const listRuleRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
