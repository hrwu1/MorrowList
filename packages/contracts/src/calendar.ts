import { z } from "zod";

import { plainDateSchema } from "./common.js";
import { taskSchema } from "./task.js";

export const CALENDAR_TASK_LIMIT = 2000;
export const calendarViewQuerySchema = z
  .object({
    from: plainDateSchema,
    to: plainDateSchema,
  })
  .refine(
    ({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000,
    { message: "Choose an ordered range of at most 367 days.", path: ["to"] },
  );
export const calendarViewResponseSchema = z.object({
  data: z.object({
    from: plainDateSchema,
    to: plainDateSchema,
    timezone: z.string(),
    tasks: z.array(taskSchema),
    truncated: z.boolean(),
  }),
});
export const calendarFeedResponseSchema = z.object({
  data: z.object({ url: z.url(), createdAt: z.iso.datetime() }),
});
export const calendarFeedStatusResponseSchema = z.object({
  data: z.object({ active: z.boolean(), createdAt: z.iso.datetime().nullable() }),
});
export type CalendarViewQuery = z.infer<typeof calendarViewQuerySchema>;
export type CalendarViewResponse = z.infer<typeof calendarViewResponseSchema>;
export type CalendarFeedDto = z.infer<typeof calendarFeedResponseSchema>["data"];
export type CalendarFeedStatus = z.infer<
  typeof calendarFeedStatusResponseSchema
>["data"];
