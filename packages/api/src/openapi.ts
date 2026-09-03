import {
  activityListResponseSchema,
  activityQuerySchema,
  addTaskToDayRequestSchema,
  completeTaskRequestSchema,
  createProjectRequestSchema,
  createTaskRequestSchema,
  errorResponseSchema,
  listTasksQuerySchema,
  meResponseSchema,
  moveTaskRequestSchema,
  projectBoardQuerySchema,
  projectBoardResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  reorderTaskRequestSchema,
  taskListResponseSchema,
  taskResponseSchema,
  todayViewQuerySchema,
  todayViewResponseSchema,
  upcomingViewQuerySchema,
  upcomingViewResponseSchema,
  updateTaskRequestSchema,
} from "@morrowlist/contracts";
import { z } from "zod";

import { API_BASE_PATH } from "./app.js";

/**
 * OpenAPI 3.1 generation from the same Zod schemas the routes validate with (spec 20.7).
 *
 * Generating rather than hand-writing is what makes the CI drift check meaningful: if a
 * contract changes and the committed document is not regenerated, CI fails.
 */

const registry = {
  Task: taskResponseSchema.shape.data,
  TaskList: taskListResponseSchema,
  ProjectDetail: projectResponseSchema,
  ProjectList: projectListResponseSchema,
  ProjectBoard: projectBoardResponseSchema,
  ActivityList: activityListResponseSchema,
  CreateProjectRequest: createProjectRequestSchema,
  CreateTaskRequest: createTaskRequestSchema,
  UpdateTaskRequest: updateTaskRequestSchema,
  MoveTaskRequest: moveTaskRequestSchema,
  ReorderTaskRequest: reorderTaskRequestSchema,
  CompleteTaskRequest: completeTaskRequestSchema,
  AddTaskToDayRequest: addTaskToDayRequestSchema,
  TodayView: todayViewResponseSchema,
  UpcomingView: upcomingViewResponseSchema,
  MeResponse: meResponseSchema,
  ErrorResponse: errorResponseSchema,
} as const;

function ref(name: keyof typeof registry) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonContent(schema: object) {
  return { content: { "application/json": { schema } } };
}

/** Errors every authenticated endpoint can return (spec 20.2). */
const commonErrors = {
  "401": {
    description: "Authentication required",
    ...jsonContent(ref("ErrorResponse")),
  },
  "403": { description: "Forbidden", ...jsonContent(ref("ErrorResponse")) },
  "422": { description: "Validation failed", ...jsonContent(ref("ErrorResponse")) },
  "500": { description: "Internal error", ...jsonContent(ref("ErrorResponse")) },
};

const workspaceIdParam = {
  name: "workspaceId",
  in: "query",
  required: false,
  description:
    "Target workspace. Optional when the caller can reach exactly one workspace.",
  schema: { type: "string", format: "uuid" },
};

const taskIdParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const projectIdParam = {
  name: "projectId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

export function buildOpenApiDocument(version = "1.0.0"): Record<string, unknown> {
  const schemas = Object.fromEntries(
    Object.entries(registry).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema as z.ZodType, { target: "draft-2020-12", io: "output" }),
    ]),
  );

  return {
    openapi: "3.1.0",
    info: {
      title: "MorrowList API",
      version,
      description:
        "REST interface to the canonical MorrowList task model. Every capability in the product is reachable here, so the web UI, the CLI, and third-party clients are peers.",
    },
    servers: [{ url: API_BASE_PATH }],
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Browser session issued by the auth provider.",
        },
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Workspace-scoped API key used by the CLI and integrations.",
        },
      },
      parameters: { workspaceId: workspaceIdParam },
    },
    security: [{ sessionCookie: [] }, { apiKey: [] }],
    paths: {
      "/health": {
        get: {
          summary: "Liveness probe",
          security: [],
          responses: { "200": { description: "The process is running" } },
        },
      },
      "/ready": {
        get: {
          summary: "Readiness probe",
          security: [],
          responses: {
            "200": { description: "Dependencies are reachable" },
            "503": { description: "A dependency is unavailable" },
          },
        },
      },
      "/me": {
        get: {
          summary: "Current user, workspaces, and capabilities",
          responses: {
            "200": { description: "The caller", ...jsonContent(ref("MeResponse")) },
            ...commonErrors,
          },
        },
      },
      "/projects": {
        get: {
          summary: "List projects",
          parameters: [workspaceIdParam],
          responses: {
            "200": {
              description: "The workspace's active projects",
              ...jsonContent(ref("ProjectList")),
            },
            ...commonErrors,
          },
        },
        post: {
          summary: "Create a project with its default workflow",
          parameters: [workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("CreateProjectRequest")),
          },
          responses: {
            "201": {
              description: "The created project and workflow",
              ...jsonContent(ref("ProjectDetail")),
            },
            ...commonErrors,
          },
        },
      },
      "/projects/{projectId}": {
        get: {
          summary: "Get a project and its ordered workflow",
          parameters: [projectIdParam, workspaceIdParam],
          responses: {
            "200": {
              description: "The project and its active statuses",
              ...jsonContent(ref("ProjectDetail")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/projects/{projectId}/board": {
        get: {
          summary: "Get a normalized project board",
          description:
            "Statuses and tasks are returned in manual-rank order. The page signal explicitly reports when the bounded task projection was truncated.",
          parameters: [
            projectIdParam,
            workspaceIdParam,
            ...queryParameters(projectBoardQuerySchema),
          ],
          responses: {
            "200": {
              description: "The board projection",
              ...jsonContent(ref("ProjectBoard")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/projects/{projectId}/activity": {
        get: {
          summary: "List a project's activity",
          description:
            "The project's own events and those of the tasks in it, newest first. Read-only and cursor-paginated.",
          parameters: [
            projectIdParam,
            workspaceIdParam,
            ...queryParameters(activityQuerySchema),
          ],
          responses: {
            "200": {
              description: "A page of activity",
              ...jsonContent(ref("ActivityList")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks": {
        get: {
          summary: "List tasks",
          parameters: [workspaceIdParam, ...queryParameters(listTasksQuerySchema)],
          responses: {
            "200": { description: "A page of tasks", ...jsonContent(ref("TaskList")) },
            ...commonErrors,
          },
        },
        post: {
          summary: "Create a task",
          description:
            "Only `title` is required. With no project the task is created in the Inbox.",
          parameters: [workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("CreateTaskRequest")) },
          responses: {
            "201": { description: "The created task", ...jsonContent(ref("Task")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{idOrKey}": {
        get: {
          summary: "Get a task by UUID or workspace key",
          parameters: [
            {
              name: "idOrKey",
              in: "path",
              required: true,
              description: "Task UUID or workspace key such as ML-142.",
              schema: { type: "string" },
            },
            workspaceIdParam,
          ],
          responses: {
            "200": { description: "The task", ...jsonContent(ref("Task")) },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{idOrKey}/activity": {
        get: {
          summary: "List a task's activity",
          description:
            "Immutable history of the task, newest first, with a safe summary, the actor, and the changed fields a person can read. A task in the Trash still answers.",
          parameters: [
            {
              name: "idOrKey",
              in: "path",
              required: true,
              description: "Task UUID or workspace key such as ML-142.",
              schema: { type: "string" },
            },
            workspaceIdParam,
            ...queryParameters(activityQuerySchema),
          ],
          responses: {
            "200": {
              description: "A page of activity",
              ...jsonContent(ref("ActivityList")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}": {
        patch: {
          summary: "Update simple task fields",
          description:
            "An omitted field is left unchanged; a field explicitly set to null is cleared.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("UpdateTaskRequest")) },
          responses: {
            "200": { description: "The updated task", ...jsonContent(ref("Task")) },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Move a task to Trash",
          parameters: [taskIdParam, workspaceIdParam],
          responses: {
            "200": { description: "The deleted task", ...jsonContent(ref("Task")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/complete": {
        post: {
          summary: "Complete a task",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("CompleteTaskRequest")) },
          responses: {
            "200": { description: "The completed task", ...jsonContent(ref("Task")) },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/move": {
        post: {
          summary: "Move a task to another project status or the Inbox",
          description:
            "Neighbour IDs describe the intended position; the server computes the authoritative rank.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("MoveTaskRequest")) },
          responses: {
            "200": { description: "The moved task", ...jsonContent(ref("Task")) },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/reorder": {
        post: {
          summary: "Reorder a task within its current status",
          description:
            "Neighbour IDs describe the intended position; the server computes the authoritative rank.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("ReorderTaskRequest")),
          },
          responses: {
            "200": {
              description: "The reordered task",
              ...jsonContent(ref("Task")),
            },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/reopen": {
        post: {
          summary: "Reopen a completed task",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("CompleteTaskRequest")) },
          responses: {
            "200": { description: "The reopened task", ...jsonContent(ref("Task")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/restore": {
        post: {
          summary: "Restore a task from Trash",
          parameters: [taskIdParam, workspaceIdParam],
          responses: {
            "200": { description: "The restored task", ...jsonContent(ref("Task")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/today": {
        post: {
          summary: "Add a task to My Day",
          description:
            "The date defaults to the workspace's current date. Adding a task to a day it is already planned for changes nothing. The task itself is untouched: no version bump, no due date or status change.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("AddTaskToDayRequest")) },
          responses: {
            "200": {
              description: "The task with its day plans",
              ...jsonContent(ref("Task")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/today/{date}": {
        delete: {
          summary: "Remove a My Day selection",
          parameters: [
            taskIdParam,
            {
              name: "date",
              in: "path",
              required: true,
              description: "The plan date to remove, as YYYY-MM-DD.",
              schema: { type: "string", format: "date" },
            },
            workspaceIdParam,
          ],
          responses: {
            "200": {
              description: "The task with its day plans",
              ...jsonContent(ref("Task")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/views/today": {
        get: {
          summary: "Today projection",
          description:
            "The de-duplicated union of overdue, due-today, and My Day tasks in the workspace timezone, each task once under its highest-precedence section with badges for every reason, plus yesterday's unfinished manual selections for review.",
          parameters: [workspaceIdParam, ...queryParameters(todayViewQuerySchema)],
          responses: {
            "200": { description: "The Today view", ...jsonContent(ref("TodayView")) },
            ...commonErrors,
          },
        },
      },
      "/views/upcoming": {
        get: {
          summary: "Upcoming projection",
          description:
            "Open tasks due after the start date, grouped by due date within a 7, 14, 30-day, or open horizon.",
          parameters: [workspaceIdParam, ...queryParameters(upcomingViewQuerySchema)],
          responses: {
            "200": {
              description: "The Upcoming view",
              ...jsonContent(ref("UpcomingView")),
            },
            ...commonErrors,
          },
        },
      },
    },
  };
}

/** Flatten a query schema into individual OpenAPI query parameters. */
function queryParameters(schema: z.ZodType): unknown[] {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as { properties?: Record<string, unknown>; required?: string[] };

  return Object.entries(json.properties ?? {})
    .filter(([name]) => name !== "workspaceId")
    .map(([name, property]) => ({
      name,
      in: "query",
      required: json.required?.includes(name) ?? false,
      schema: property,
    }));
}
