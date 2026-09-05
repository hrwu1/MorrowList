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
  createSavedViewRequestSchema,
  createTaskRequestSchema,
  errorResponseSchema,
  exportTasksCsvQuerySchema,
  exportWorkspaceQuerySchema,
  flowQuerySchema,
  importQuerySchema,
  importRequestSchema,
  importResultSchema,
  flowResponseSchema,
  listNotificationsQuerySchema,
  listProjectsQuerySchema,
  listStatusesQuerySchema,
  listTasksQuerySchema,
  meResponseSchema,
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
  notificationResponseSchema,
  pushSubscriptionRequestSchema,
  pushSubscriptionResponseSchema,
  updateNotificationPreferencesRequestSchema,
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
  reorderSavedViewRequestSchema,
  savedViewListResponseSchema,
  savedViewResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
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
  updateSavedViewRequestSchema,
  updateTagRequestSchema,
  updateProjectRequestSchema,
  updateStatusRequestSchema,
  updateTaskRequestSchema,
  updateWorkspaceRequestSchema,
  workflowStatusListResponseSchema,
  workflowStatusResponseSchema,
  workspaceExportSchema,
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
  ProjectFlow: flowResponseSchema,
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
  SearchResponse: searchResponseSchema,
  SavedView: savedViewResponseSchema,
  SavedViewList: savedViewListResponseSchema,
  CreateSavedViewRequest: createSavedViewRequestSchema,
  UpdateSavedViewRequest: updateSavedViewRequestSchema,
  ReorderSavedViewRequest: reorderSavedViewRequestSchema,
  MeResponse: meResponseSchema,
  Workspace: workspaceResponseSchema,
  UpdateWorkspaceRequest: updateWorkspaceRequestSchema,
  Notification: notificationResponseSchema,
  NotificationList: notificationListResponseSchema,
  NotificationPreferences: notificationPreferencesResponseSchema,
  UpdateNotificationPreferencesRequest: updateNotificationPreferencesRequestSchema,
  PushSubscriptionRequest: pushSubscriptionRequestSchema,
  PushSubscription: pushSubscriptionResponseSchema,
  ErrorResponse: errorResponseSchema,
  WorkspaceExport: workspaceExportSchema,
  ImportRequest: importRequestSchema,
  ImportResult: importResultSchema,
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
      "/exports/workspace.json": {
        get: {
          summary: "Download the whole workspace as a versioned JSON archive",
          description:
            "The archive of spec 30.2: workspace, projects, statuses, tasks (trashed ones included), tags, task tags, relations, My Day history, the caller's saved views, and activity. No password hash, session token, API key, or push registration key can appear. Derived tables are absent: flow intervals are rebuilt by the flow backfill and reminders are recomputed from each task's own offset. Streamed as an attachment.",
          parameters: [
            workspaceIdParam,
            ...queryParameters(exportWorkspaceQuerySchema),
          ],
          responses: {
            "200": {
              description: "The archive",
              ...jsonContent(ref("WorkspaceExport")),
            },
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/exports/tasks.csv": {
        get: {
          summary: "Download tasks as CSV",
          description:
            "Takes the same filters as GET /tasks, without paging: every match is written. Columns: key, title, description, status, priority, dueDate, deadline, deferUntil, tags, parentKey, completed — the ones POST /imports/csv reads back.",
          parameters: [workspaceIdParam, ...queryParameters(exportTasksCsvQuerySchema)],
          responses: {
            "200": {
              description: "The task CSV",
              content: { "text/csv": { schema: { type: "string" } } },
            },
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/imports/{source}": {
        post: {
          summary: "Import a Trello board or a CSV as a new project",
          description:
            "`source` is `trello` (a board's JSON export) or `csv`. With `dryRun=true` nothing is written and the preview reports the columns, tags, counts, ignored fields and rejected rows; without it the same plan runs as one transaction and `projectId` names the project it created. The project name must be free.",
          parameters: [
            {
              name: "source",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["trello", "csv"] },
            },
            workspaceIdParam,
            ...queryParameters(importQuerySchema),
          ],
          requestBody: { required: true, ...jsonContent(ref("ImportRequest")) },
          responses: {
            "200": {
              description: "The dry-run preview; nothing was written",
              ...jsonContent(ref("ImportResult")),
            },
            "201": {
              description: "The imported project",
              ...jsonContent(ref("ImportResult")),
            },
            ...notFound,
            ...commonErrors,
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
      "/me/notification-preferences": {
        get: {
          summary: "The caller's notification preferences for a workspace",
          description:
            "Channels, daily digest time, timezone, and the reminder offset new timed tasks receive. Defaults are returned until the caller changes something.",
          parameters: [workspaceIdParam],
          responses: {
            "200": {
              description: "The preferences",
              ...jsonContent(ref("NotificationPreferences")),
            },
            ...commonErrors,
          },
        },
        patch: {
          summary: "Update notification preferences",
          description:
            "An omitted field is left unchanged; digestTime and timezone set to null clear them.",
          parameters: [workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("UpdateNotificationPreferencesRequest")),
          },
          responses: {
            "200": {
              description: "The updated preferences",
              ...jsonContent(ref("NotificationPreferences")),
            },
            ...commonErrors,
          },
        },
      },
      "/me/push-subscriptions": {
        post: {
          summary: "Register a browser for web push",
          description:
            "Accepts the browser's PushSubscription.toJSON() shape. Delivery over push starts once the service worker ships; the keys are never returned.",
          requestBody: {
            required: true,
            ...jsonContent(ref("PushSubscriptionRequest")),
          },
          responses: {
            "201": {
              description: "The registration",
              ...jsonContent(ref("PushSubscription")),
            },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Remove a push registration",
          parameters: [
            {
              name: "endpoint",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "204": { description: "Removed, or was never registered" },
            ...commonErrors,
          },
        },
      },
      "/notifications": {
        get: {
          summary: "The caller's notifications in a workspace",
          description:
            "Newest first, with the unread total for the workspace. Reminders and daily digests both land here.",
          parameters: [
            workspaceIdParam,
            ...queryParameters(listNotificationsQuerySchema),
          ],
          responses: {
            "200": {
              description: "A page of notifications",
              ...jsonContent(ref("NotificationList")),
            },
            ...commonErrors,
          },
        },
      },
      "/notifications/{id}/read": {
        post: {
          summary: "Mark a notification read",
          parameters: [taskIdParam, workspaceIdParam],
          responses: {
            "200": {
              description: "The notification",
              ...jsonContent(ref("Notification")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/notifications/{id}/snooze": {
        post: {
          summary: "Snooze a reminder for an hour",
          description:
            "Marks the notification read and arms the task's reminder again one hour from now.",
          parameters: [taskIdParam, workspaceIdParam],
          responses: {
            "200": {
              description: "The notification",
              ...jsonContent(ref("Notification")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
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
      "/projects/{projectId}/flow": {
        get: {
          summary: "Get a project's flow metrics",
          description:
            "Cycle time and lead time percentiles, weekly throughput, work in progress, the cumulative flow diagram and aging work in progress, computed from the status intervals every task change records. Read-only.",
          parameters: [
            projectIdParam,
            workspaceIdParam,
            ...queryParameters(flowQuerySchema),
          ],
          responses: {
            "200": {
              description: "The flow summary",
              ...jsonContent(ref("ProjectFlow")),
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
      "/search": {
        get: {
          summary: "Search tasks and projects",
          description:
            "Free text is prefix-matched against titles, descriptions and tag names; a task key such as ML-12 is resolved first. `q` also accepts the operators due:, priority:, tag:, is:open|done|blocked and in:inbox, which override the same explicit filter. Match positions are returned as character offsets, never markup. Project name hits are listed for navigation on the first page.",
          parameters: [workspaceIdParam, ...queryParameters(searchQuerySchema)],
          responses: {
            "200": {
              description: "A page of task hits plus project hits",
              ...jsonContent(ref("SearchResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/views/saved": {
        get: {
          summary: "List the caller's saved views",
          description:
            "Saved views are personal: only the owner sees them, in sidebar order.",
          parameters: [workspaceIdParam],
          responses: {
            "200": {
              description: "The caller's saved views",
              ...jsonContent(ref("SavedViewList")),
            },
            ...commonErrors,
          },
        },
        post: {
          summary: "Save the current filters as a personal view",
          description:
            "Names are unique per owner, case-insensitively. The new view is placed last in the sidebar.",
          parameters: [workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("CreateSavedViewRequest")),
          },
          responses: {
            "201": { description: "The saved view", ...jsonContent(ref("SavedView")) },
            "409": {
              description: "A view with this name already exists",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
      },
      "/views/saved/{id}": {
        patch: {
          summary: "Rename, refilter, or relayout a saved view",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("UpdateSavedViewRequest")),
          },
          responses: {
            "200": {
              description: "The updated view",
              ...jsonContent(ref("SavedView")),
            },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            "409": {
              description: "A view with this name already exists",
              ...jsonContent(ref("ErrorResponse")),
            },
            ...commonErrors,
          },
        },
        delete: {
          summary: "Delete a saved view",
          parameters: [taskIdParam, workspaceIdParam],
          responses: {
            "204": { description: "The view was deleted" },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
            ...commonErrors,
          },
        },
      },
      "/views/saved/{id}/reorder": {
        post: {
          summary: "Move a saved view in the sidebar",
          description:
            "Neighbour IDs describe the intended position among the caller's own views; the server computes the rank.",
          parameters: [taskIdParam, workspaceIdParam],
          requestBody: {
            required: true,
            ...jsonContent(ref("ReorderSavedViewRequest")),
          },
          responses: {
            "200": { description: "The moved view", ...jsonContent(ref("SavedView")) },
            "404": { description: "Not found", ...jsonContent(ref("ErrorResponse")) },
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
