import { z } from "zod";

import { uuidSchema } from "./common.js";

export const inboundAddressSchema = z.object({
  address: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime().nullable(),
});
export const inboundAddressResponseSchema = z.object({ data: inboundAddressSchema });
export type InboundAddressDto = z.infer<typeof inboundAddressSchema>;

/** The transport-neutral envelope accepted from a trusted delivery adapter. */
export const inboundEmailSchema = z.object({
  messageId: z.string().trim().min(1).max(500),
  recipient: z.email().max(320),
  from: z.string().max(500).default(""),
  subject: z.string().max(2000).default(""),
  text: z.string().max(200_000).default(""),
  html: z.string().max(500_000).default(""),
  attachmentCount: z.number().int().min(0).max(1000).default(0),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;
export const inboundEmailResultSchema = z.object({
  taskId: uuidSchema,
  duplicate: z.boolean(),
});
export type InboundEmailResult = z.infer<typeof inboundEmailResultSchema>;
