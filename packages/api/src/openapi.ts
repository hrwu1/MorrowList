import {
  activityListResponseSchema,
  activityQuerySchema,
  addTaskRelationRequestSchema,
  addTaskToDayRequestSchema,
  archiveStatusRequestSchema,
  completeTaskRequestSchema,
  createProjectRequestSchema,
  createTagRequestSchema,
  createStatusRequestSchema,
  createTaskRequestSchema,
  errorResponseSchema,
  listProjectsQuerySchema,
  listStatusesQuerySchema,
  listTasksQuerySchema,
  meResponseSchema,
  moveTaskRequestSchema,
  projectBoardQuerySchema,
  projectBoardResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  projectSchema,
  projectVersionRequestSchema,
  reorderStatusRequestSchema,
  reopenTaskRequestSchema,
  reorderTaskRequestSchema,
  setTaskBlockedRequestSchema,
  setTaskParentRequestSchema,
  tagListResponseSchema,
  tagResponseSchema,
  taskCommandResponseSchema,
  taskListResponseSchema,
  taskResponseSchema,
  todayViewQuerySchema,
  todayViewResponseSchema,
  upcomingViewQuerySchema,
  upcomingViewResponseSchema,
  updateTagRequestSchema,
  updateProjectRequestSchema,
  updateStatusRequestSchema,
  updateTaskRequestSchema,
  updateWorkspaceRequestSchema,
  workflowStatusListResponseSchema,
  workflowStatusResponseSchema,
  workspaceResponseSchema,
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
  TaskCommandResult: taskCommandResponseSchema,
  TaskList: taskListResponseSchema,
  ProjectDetail: projectResponseSchema,
  Project: z.object({ data: projectSchema }),
  ProjectList: projectListResponseSchema,
  ProjectBoard: projectBoardResponseSchema,
  ActivityList: activityListResponseSchema,
  Tag: tagResponseSchema,
  TagList: tagListResponseSchema,
  CreateTagRequest: createTagRequestSchema,
  UpdateTagRequest: updateTagRequestSchema,
  WorkflowStatus: workflowStatusResponseSchema,
  WorkflowStatusList: workflowStatusListResponseSchema,
  CreateProjectRequest: createProjectRequestSchema,
  UpdateProjectRequest: updateProjectRequestSchema,
  ProjectVersionRequest: projectVersionRequestSchema,
  CreateStatusRequest: createStatusRequestSchema,
  UpdateStatusRequest: updateStatusRequestSchema,
  ReorderStatusRequest: reorderStatusRequestSchema,
  ArchiveStatusRequest: archiveStatusRequestSchema,
  CreateTaskRequest: createTaskRequestSchema,
  UpdateTaskRequest: updateTaskRequestSchema,
  MoveTaskRequest: moveTaskRequestSchema,
  ReorderTaskRequest: reorderTaskRequestSchema,
  CompleteTaskRequest: completeTaskRequestSchema,
  ReopenTaskRequest: reopenTaskRequestSchema,
  AddTaskRelationRequest: addTaskRelationRequestSchema,
  SetTaskBlockedRequest: setTaskBlockedRequestSchema,
  AddTaskToDayRequest: addTaskToDayRequestSchema,
  TodayView: todayViewResponseSchema,
  UpcomingView: upcomingViewResponseSchema,
  SetTaskParentRequest: setTaskParentRequestSchema,
  MeResponse: meResponseSchema,
  Workspace: workspaceResponseSchema,
  UpdateWorkspaceRequest: updateWorkspaceRequestSchema,
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

const tagIdParam = {
  name: "tagId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const statusIdParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const notFound = {
  "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
};
const conflict = {
  "409": {
    description: "Version conflict or a workflow rule needs a choice first",
    ...jsonContent(ref("ErrorResponse")),
  },
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
      "/workspaces/{id}": {
        patch: {
          summary:
            "Update a workspace's name, key prefix, timezone, or in-progress limit",
          description:
            "The in-progress limit counts open tasks in in-progress columns across every project. Exceeding it warns on move and reopen; it never blocks.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            ...jsonContent(ref("UpdateWorkspaceRequest")),
          },
          responses: {
            "200": {
              description: "The updated workspace",
              ...jsonContent(ref("Workspace")),
            },
            ...notFound,
            ...conflict,
            ...commonErrors,
          },
        },
      },
      "/projects": {
        get: {
          summary: "List projects",
          description:
            "Archived projects are omitted unless `includeArchived` is true.",
          parameters: [workspaceIdParam, ...queryParameters(listProjectsQuerySchema)],
          responses: {
            "200": {
              description: "The workspace's projects",
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
            ...notFound,
            ...commonErrors,
          },
        },
        patch: {
          summary: "Update a project's name, description, colour, or icon",
          description:
            "An omitted field is left unchanged; a field explicitly set to null is cleared.",
          parameters: [projectIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("UpdateProjectRequest")) },
          responses: {
            "200": {
              description: "The updated project",
              ...jsonContent(ref("Project")),
            },
            ...notFound,
            ...conflict,
            ...commonErrors,
          },
        },
      },
      "/projects/{projectId}/archive": {
        post: {
          summary: "Archive a project",
          description:
            "Hides the project from navigation and keeps every task (spec 8.6).",
          parameters: [projectIdParam, workspaceIdParam],
          requestBody: {
            required: false,
            ...jsonContent(ref("ProjectVersionRequest")),
          },
          responses: {
            "200": {
              description: "The archived project",
              ...jsonContent(ref("Project")),
            },
            ...notFound,
            ...conflict,
            ...commonErrors,
          },
        },
      },
      "/projects/{projectId}/restore": {
        post: {
          summary: "Restore an archived project",
          parameters: [projectIdParam, workspaceIdParam],
          requestBody: {
            required: false,
            ...jsonContent(ref("ProjectVersionRequest")),
          },
          responses: {
            "200": {
              description: "The restored project",
              ...jsonContent(ref("Project")),
            },
            ...notFound,
            ...conflict,
            ...commonErrors,
          },
        },
      },
      "/projects/{projectId}/statuses": {
        get: {
          summary: "List a project's workflow statuses in order",
          parameters: [
            projectIdParam,
            workspaceIdParam,
            ...queryParameters(listStatusesQuerySchema),
          ],
          responses: {
            "200": {
              description: "The statuses, ranked",
              ...jsonContent(ref("WorkflowStatusList")),
            },
            ...notFound,
            ...commonErrors,
          },
        },
        post: {
          summary: "Add a workflow status at the end of the board",
          parameters: [projectIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("CreateStatusRequest")) },
          responses: {
            "201": {
              description: "The created status",
              ...jsonContent(ref("WorkflowStatus")),
            },
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/statuses/{id}": {
        patch: {
          summary: "Update a workflow status",
          description:
            "Rename, recolour, set a WIP limit or policy, change the category, or make it the default. A category change across the Done boundary completes or reopens the tasks in the column. Renaming never changes the category.",
          parameters: [statusIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("UpdateStatusRequest")) },
          responses: {
            "200": {
              description: "The updated status",
              ...jsonContent(ref("WorkflowStatus")),
            },
            ...notFound,
            ...conflict,
            ...commonErrors,
          },
        },
      },
      "/statuses/{id}/reorder": {
        post: {
          summary: "Reorder a workflow status",
          description:
            "Neighbour IDs describe the intended position; the server computes the authoritative rank.",
          parameters: [statusIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("ReorderStatusRequest")) },
          responses: {
            "200": {
              description: "The reordered status",
              ...jsonContent(ref("WorkflowStatus")),
            },
            ...notFound,
            ...conflict,
            ...commonErrors,
          },
        },
      },
      "/statuses/{id}/archive": {
        post: {
          summary: "Move a status's tasks to another status and archive it atomically",
          description:
            "A status with tasks needs `destinationStatusId` (STATUS_ARCHIVE_REQUIRES_DESTINATION otherwise); the default status needs a replacement default (STATUS_ARCHIVE_REQUIRES_REPLACEMENT otherwise), which falls back to the destination. The last Done or last non-Done status cannot be archived (WORKFLOW_INVARIANT_VIOLATED).",
          parameters: [statusIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("ArchiveStatusRequest")) },
          responses: {
            "200": {
              description: "The archived status",
              ...jsonContent(ref("WorkflowStatus")),
            },
            ...notFound,
            ...conflict,
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
      "/tags": {
        get: {
          summary: "List tags",
          description:
            "Every tag in the workspace, ordered case-insensitively by name, with the number of live tasks carrying each.",
          parameters: [workspaceIdParam],
          responses: {
            "200": {
              description: "The workspace's tags",
              ...jsonContent(ref("TagList")),
            },
            ...commonErrors,
          },
        },
        post: {
          summary: "Create a tag",
          description: "Names are unique per workspace, case-insensitively.",
          parameters: [workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("CreateTagRequest")) },
          responses: {
            "201": { description: "The created tag", ...jsonContent(ref("Tag")) },
            "409": {
              description: "A tag with this name already exists",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/tags/{id}": {
        patch: {
          summary: "Rename, recolour, or describe a tag",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("UpdateTagRequest")) },
          responses: {
            "200": { description: "The updated tag", ...jsonContent(ref("Tag")) },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            "409": {
              description: "A tag with this name already exists",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Delete a tag",
          description:
            "Removes the tag from every task; the tasks themselves are untouched.",
          parameters: [taskIdParam, workspaceIdParam],
          responses: {
            "204": { description: "The tag was deleted" },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/tags/{tagId}": {
        post: {
          summary: "Add a tag to a task",
          description:
            "The task's version is unchanged: tags are a relation, not a task column. Adding a tag the task already carries is a no-op.",
          parameters: [taskIdParam, tagIdParam, workspaceIdParam],
          responses: {
            "200": {
              description: "The task with its tags",
              ...jsonContent(ref("Task")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Remove a tag from a task",
          parameters: [taskIdParam, tagIdParam, workspaceIdParam],
          responses: {
            "200": {
              description: "The task with its tags",
              ...jsonContent(ref("Task")),
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
          description:
            "A blocked task (an open blocks predecessor, or the blocker flag) completes only with `acknowledgeBlocked: true`; otherwise the command answers TASK_BLOCKED and changes nothing.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("CompleteTaskRequest")) },
          responses: {
            "200": { description: "The completed task", ...jsonContent(ref("Task")) },
            "409": {
              description: "Version conflict, or the task is blocked",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/relations": {
        post: {
          summary: "Relate this task to another",
          description:
            "`blocks` reads source (this task) → target; `related_to` is symmetric and stored once. Neither task's version changes. A blocks edge that would close a loop is rejected with TASK_RELATION_CYCLE; an edge that already exists is a no-op.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("AddTaskRelationRequest")),
          },
          responses: {
            "201": {
              description: "This task with its relations",
              ...jsonContent(ref("Task")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/relations/{relationId}": {
        delete: {
          summary: "Remove a relation from either endpoint",
          parameters: [
            taskIdParam,
            {
              name: "relationId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            workspaceIdParam,
          ],
          responses: {
            "200": {
              description: "This task with its remaining relations",
              ...jsonContent(ref("Task")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/blocked": {
        post: {
          summary: "Flag a task as blocked with a reason",
          description:
            "The task stays in its workflow status; the flag is the signal. Flagging again replaces the reason and keeps the original start time.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("SetTaskBlockedRequest")) },
          responses: {
            "200": { description: "The flagged task", ...jsonContent(ref("Task")) },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Clear the blocked flag",
          parameters: [
            taskIdParam,
            workspaceIdParam,
            {
              name: "expectedVersion",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": { description: "The unflagged task", ...jsonContent(ref("Task")) },
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
            "Neighbour IDs describe the intended position; the server computes the authoritative rank. Entering an in-progress column past the workspace limit adds a warning; the move still succeeds.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("MoveTaskRequest")) },
          responses: {
            "200": {
              description: "The moved task and any limit warnings",
              ...jsonContent(ref("TaskCommandResult")),
            },
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
          description:
            "Returns the task to its last active status. Landing in an in-progress column past the workspace limit adds a warning; the reopen still succeeds.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("ReopenTaskRequest")) },
          responses: {
            "200": {
              description: "The reopened task and any limit warnings",
              ...jsonContent(ref("TaskCommandResult")),
            },
            ...commonErrors,
          },
        },
      },
      "/tasks/{id}/skip": {
        post: {
          summary: "Skip the current occurrence of a repeating task",
          description:
            "The task itself moves on to its next occurrence; nothing is created. A task without a recurrence rule, a completed one, or the last occurrence of a bounded series is rejected with VALIDATION_FAILED.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: false, ...jsonContent(ref("CompleteTaskRequest")) },
          responses: {
            "200": {
              description: "The task on its next occurrence",
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
      "/tasks/{id}/parent": {
        post: {
          summary: "Make a task a subtask of another",
          description:
            "The parent must be a live task in the same workspace. A cycle is rejected with TASK_RELATION_CYCLE and a fourth nesting level with TASK_NESTING_LIMIT_EXCEEDED.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: { required: true, ...jsonContent(ref("SetTaskParentRequest")) },
          responses: {
            "200": {
              description: "The task, now a subtask",
              ...jsonContent(ref("Task")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Detach a subtask from its parent",
          parameters: [
            taskIdParam,
            workspaceIdParam,
            {
              name: "expectedVersion",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": { description: "The detached task", ...jsonContent(ref("Task")) },
            "409": {
              description: "Version conflict",
              ...jsonContent(ref("ErrorResponse")),
            },
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
