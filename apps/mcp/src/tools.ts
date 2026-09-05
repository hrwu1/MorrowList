import type { ApiClient } from "@morrowlist/api-client";
import type { TaskDto } from "@morrowlist/contracts";
import { z } from "zod";

/**
 * The MCP tool surface (GAP-18, `docs/adr/pending-mcp-server.md`).
 *
 * Seven tools, deliberately. Every one of them is a call to the same public REST API the
 * web app and the CLI use, so an agent is subject to the same validation, authorization,
 * activity recording and concurrency checks as a person.
 *
 * Two budgets shape this file:
 *
 * 1. **Descriptions** are charged on every model turn, whether or not a tool is used, so
 *    the whole surface is capped at 2,000 tokens and `tools.test.ts` fails if it grows.
 *    Detail that does not fit belongs in `morrow usage` and the OpenAPI document.
 * 2. **Results** are charged once per call, so a task is returned as the dozen fields an
 *    agent acts on rather than the full DTO. `get_task` returns more than `list_tasks`,
 *    because that is what asking for one task means.
 */

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

/**
 * A uuid, described rather than pattern-matched. `z.uuid()` emits a 170-character regex
 * into the advertised schema — repeated once per field, that is a quarter of the whole
 * description budget spent telling a model what a uuid looks like. The server validates
 * the real thing; this only has to be unambiguous.
 */
const idField = z.string().min(36).max(36).describe("uuid");

const priorityField = z.enum(["none", "low", "medium", "high", "urgent"]);

/** The fields an agent acts on. Everything else is one `get_task` away. */
export interface TaskSummary {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly priority: string;
  readonly done: boolean;
  readonly dueDate?: string;
  readonly deadline?: string;
  readonly projectId?: string;
  readonly statusId?: string;
  readonly blocked?: true;
  readonly tags?: readonly string[];
  readonly version: number;
}

export function toSummary(task: TaskDto): TaskSummary {
  return {
    key: task.key,
    id: task.id,
    title: task.title,
    priority: task.priority,
    done: task.isCompleted,
    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    ...(task.deadline ? { deadline: task.deadline } : {}),
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.statusId ? { statusId: task.statusId } : {}),
    ...(task.isBlocked ? { blocked: true as const } : {}),
    ...(task.tags.length > 0 ? { tags: task.tags.map((tag) => tag.name) } : {}),
    version: task.version,
  };
}

/** One tool: what the model is told, and what the server does about it. */
export interface McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Shape;
  /** Hints the client shows the user before approving a call. */
  readonly annotations: { readonly readOnlyHint: boolean; readonly idempotentHint?: boolean };
  run(client: ApiClient, args: z.infer<z.ZodObject<Shape>>): Promise<unknown>;
}

function tool<Shape extends z.ZodRawShape>(definition: McpTool<Shape>): McpTool {
  return definition as unknown as McpTool;
}

export const TOOLS: readonly McpTool[] = [
  tool({
    name: "list_tasks",
    title: "List tasks",
    description:
      "Tasks in the workspace, newest board order first. Filter by project, status, priority, completion, or due window. Returns compact task summaries; call get_task for full detail.",
    inputSchema: {
      projectId: idField.optional().describe("Project to list; omit for all"),
      statusId: idField.optional(),
      priority: priorityField.optional(),
      due: z
        .enum(["overdue", "today", "future", "none"])
        .optional()
        .describe("Due window relative to the workspace's today"),
      isCompleted: z.boolean().optional().describe("Default: open tasks only"),
      inbox: z.boolean().optional().describe("Only tasks with no project"),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
    },
    annotations: { readOnlyHint: true },
    async run(client, args) {
      const page = await client.listTasks({
        ...(args.projectId ? { projectId: args.projectId } : {}),
        ...(args.statusId ? { statusId: args.statusId } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
        ...(args.due ? { due: args.due } : {}),
        ...(args.isCompleted === undefined ? {} : { isCompleted: args.isCompleted }),
        ...(args.inbox === undefined ? {} : { inbox: args.inbox }),
        limit: args.limit ?? 50,
      });
      return {
        tasks: page.data.map(toSummary),
        hasMore: page.page.hasMore,
      };
    },
  }),

  tool({
    name: "get_task",
    title: "Get a task",
    description:
      "One task in full, by key (ML-142) or id: description, dates, tags, relations, subtask progress, and the version needed for a safe update.",
    inputSchema: {
      task: z.string().min(1).describe("Task key such as ML-142, or its uuid"),
    },
    annotations: { readOnlyHint: true },
    async run(client, args) {
      const task = await client.getTask(args.task);
      return {
        ...toSummary(task),
        descriptionMd: task.descriptionMd,
        dueTime: task.dueTime,
        deferUntil: task.deferUntil,
        parentTaskId: task.parentTaskId,
        subtaskProgress: task.subtaskProgress,
        relations: task.relations.map((relation) => ({
          type: relation.type,
          direction: relation.sourceTaskId === task.id ? "outgoing" : "incoming",
          task: relation.task.key,
        })),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    },
  }),

  tool({
    name: "create_task",
    title: "Create a task",
    description:
      "Add a task. With no project it lands in the Inbox. statusId requires projectId; dueTime requires dueDate.",
    inputSchema: {
      title: z.string().min(1).max(500),
      descriptionMd: z.string().max(50_000).optional().describe("Markdown"),
      projectId: idField.optional(),
      statusId: idField.optional(),
      priority: priorityField.optional(),
      dueDate: dateField.optional(),
      dueTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .describe("HH:mm, needs dueDate"),
      deadline: dateField.optional().describe("Hard date; due is when you plan to work"),
      parentTaskId: idField.optional().describe("Makes this a subtask"),
      addToDay: dateField.optional().describe("Also add to My Day for this date"),
    },
    annotations: { readOnlyHint: false },
    async run(client, args) {
      return toSummary(await client.createTask(args));
    },
  }),

  tool({
    name: "update_task",
    title: "Update a task",
    description:
      "Change a task's fields. Pass expectedVersion from get_task to fail rather than overwrite a concurrent edit. Null clears a date or the description.",
    inputSchema: {
      task: z.string().min(1).describe("Task key or uuid"),
      title: z.string().min(1).max(500).optional(),
      descriptionMd: z.string().max(50_000).nullable().optional(),
      priority: priorityField.optional(),
      dueDate: dateField.nullable().optional(),
      deadline: dateField.nullable().optional(),
      deferUntil: dateField.nullable().optional().describe("Hide until this date"),
      expectedVersion: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: false },
    async run(client, args) {
      const { task, ...patch } = args;
      const current = await client.getTask(task);
      return toSummary(await client.updateTask(current.id, patch));
    },
  }),

  tool({
    name: "move_task",
    title: "Move a task",
    description:
      "Move a task to a project and status, and optionally position it before or after another task. projectId null returns it to the Inbox. Warnings report a work-in-progress limit that was exceeded; the move still happened.",
    inputSchema: {
      task: z.string().min(1).describe("Task key or uuid"),
      projectId: idField.nullable().describe("Null for the Inbox"),
      statusId: idField.optional().describe("Needs a project"),
      beforeTaskId: idField.optional(),
      afterTaskId: idField.optional(),
      expectedVersion: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: false },
    async run(client, args) {
      const { task, ...body } = args;
      const current = await client.getTask(task);
      const result = await client.moveTask(current.id, body);
      return {
        task: toSummary(result.task),
        warnings: result.warnings.map((warning) => warning.message),
      };
    },
  }),

  tool({
    name: "complete_task",
    title: "Complete a task",
    description:
      "Mark a task done. A blocked task needs acknowledgeBlocked: true. A repeating task spawns its next occurrence here and nowhere else.",
    inputSchema: {
      task: z.string().min(1).describe("Task key or uuid"),
      acknowledgeBlocked: z.boolean().optional(),
      expectedVersion: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: false },
    async run(client, args) {
      const { task, ...body } = args;
      const current = await client.getTask(task);
      return toSummary(await client.completeTask(current.id, body));
    },
  }),

  tool({
    name: "search",
    title: "Search",
    description:
      "Full-text search over task titles and descriptions, and project names. Supports operators in q: is:open is:done due:today due:overdue priority:high tag:name project:slug, plus \"quoted phrases\".",
    inputSchema: {
      q: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(200).optional().describe("Default 20"),
    },
    annotations: { readOnlyHint: true },
    async run(client, args) {
      const results = await client.search({ q: args.q, limit: args.limit ?? 20 });
      return {
        tasks: results.data.tasks.map((hit) => toSummary(hit.task)),
        projects: results.data.projects.map((hit) => ({
          id: hit.project.id,
          name: hit.project.name,
        })),
      };
    },
  }),
];

/**
 * Token estimate for the advertised surface.
 *
 * The usual rule of thumb is four characters per token for English prose; JSON schema
 * text is punctuation-heavy and tokenizes a little worse, so this charges 3.5. No
 * tokenizer is vendored: that would be a second dependency for a number the budget only
 * needs to within a few per cent, and erring high is the safe direction.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** The cap from the ADR. Raising it needs a decision, not a commit. */
export const TOOL_DESCRIPTION_TOKEN_BUDGET = 2000;
