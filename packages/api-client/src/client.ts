import type {
  CalendarViewQuery,
  CalendarViewResponse,
  CalendarFeedDto,
  CalendarFeedStatus,
  InboundAddressDto,
  CreateRuleRequest,
  UpdateRuleRequest,
  RuleDto,
  RuleRunDto,
  RuleTestResult,
  ActivityListResponse,
  ActivityQuery,
  AddTaskRelationRequest,
  AddTaskToDayRequest,
  ArchiveStatusRequest,
  BatchTasksRequest,
  BatchTasksResponse,
  BatchTasksResult,
  BoardViewQuery,
  BoardViewResponse,
  CompleteTaskRequest,
  CreateProjectRequest,
  CreateSavedViewRequest,
  CreateFieldRequest,
  CreateTagRequest,
  CreateStatusRequest,
  CreateTaskRequest,
  ErrorCode,
  ErrorResponse,
  FieldDefinitionDto,
  FieldFilterDto,
  FieldListResponse,
  ExportTasksCsvQuery,
  ExportWorkspaceQuery,
  FlowQuery,
  FlowResponse,
  FlowSummaryDto,
  ImportRequest,
  ImportResultDto,
  ImportSource,
  ListNotificationsQuery,
  ListProjectsQuery,
  ListStatusesQuery,
  ListTasksQuery,
  MeResponse,
  MoveTaskRequest,
  NotificationDto,
  NotificationListResponse,
  NotificationPreferencesDto,
  PushConfigDto,
  PushSubscriptionDto,
  PushSubscriptionRequest,
  ProjectBoardQuery,
  ProjectBoardResponse,
  ProjectDetailDto,
  ProjectDto,
  ProjectListResponse,
  ProjectResponse,
  ReorderStatusRequest,
  ReorderTaskRequest,
  SetTaskBlockedRequest,
  ReorderSavedViewRequest,
  SavedViewDto,
  SavedViewListResponse,
  SearchQuery,
  SearchResponse,
  SetTaskParentRequest,
  TagDto,
  TagListResponse,
  TaskCommandResponse,
  TaskCommandResult,
  TaskDto,
  TaskListResponse,
  TodayViewQuery,
  TodayViewResponse,
  UpcomingViewQuery,
  UpcomingViewResponse,
  UpdateFieldRequest,
  UpdateNotificationPreferencesRequest,
  UpdateSavedViewRequest,
  UpdateTagRequest,
  UpdateProjectRequest,
  UpdateStatusRequest,
  UpdateTaskRequest,
  UpdateWebhookRequest,
  UpdateWorkspaceRequest,
  CreateWebhookRequest,
  CreatedWebhookSubscriptionDto,
  ListWebhookDeliveriesQuery,
  WebhookDeliveryDto,
  WebhookDeliveryListResponse,
  WebhookSubscriptionDto,
  WebhookSubscriptionListResponse,
  WorkflowStatusDto,
  WorkflowStatusListResponse,
  WorkflowStatusResponse,
  WorkspaceDto,
  WorkspaceExport,
  WorkspaceResponse,
} from "@morrowlist/contracts";

/**
 * The single typed client used by both the web app and the CLI (spec 16.2). Neither
 * reaches the database; both are peers of any third-party consumer of the same REST API.
 */

export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Bearer API key. Omitted in the browser, where the session cookie authenticates. */
  readonly apiKey?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
  /** Correlates a CLI invocation or a browser action across the server logs. */
  readonly requestId?: string | undefined;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Sent on mutating requests so a retry cannot duplicate the effect (spec 20.1). */
  readonly idempotencyKey?: string;
  readonly workspaceId?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly options: ApiClientOptions;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(options: ApiClientOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getInboundAddress(options: RequestOptions = {}): Promise<InboundAddressDto> {
    return (
      await this.send<{ data: InboundAddressDto }>(
        "GET",
        `/capture/address${this.queryString({}, options)}`,
        undefined,
        options,
      )
    ).data;
  }
  async rotateInboundAddress(options: RequestOptions = {}): Promise<InboundAddressDto> {
    return (
      await this.send<{ data: InboundAddressDto }>(
        "POST",
        `/capture/address/rotate${this.queryString({}, options)}`,
        undefined,
        options,
      )
    ).data;
  }

  async me(options: RequestOptions = {}): Promise<MeResponse["data"]> {
    const body = await this.send<MeResponse>("GET", "/me", undefined, options);
    return body.data;
  }

  /** Workspace settings, including the cross-project in-progress limit (GAP-20). */
  async updateWorkspace(
    workspaceId: string,
    body: UpdateWorkspaceRequest,
    options: RequestOptions = {},
  ): Promise<WorkspaceDto> {
    const response = await this.send<WorkspaceResponse>(
      "PATCH",
      `/workspaces/${encodeURIComponent(workspaceId)}`,
      body,
      options,
    );
    return response.data;
  }

  async listProjects(
    query: Partial<ListProjectsQuery> = {},
    options: RequestOptions = {},
  ): Promise<ProjectListResponse> {
    return this.send<ProjectListResponse>(
      "GET",
      `/projects${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async updateProject(
    projectId: string,
    body: UpdateProjectRequest,
    options: RequestOptions = {},
  ): Promise<ProjectDto> {
    const response = await this.send<{ data: ProjectDto }>(
      "PATCH",
      `/projects/${encodeURIComponent(projectId)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async archiveProject(
    projectId: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<ProjectDto> {
    const response = await this.send<{ data: ProjectDto }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/archive${this.queryString({}, options)}`,
      expectedVersion === undefined ? {} : { expectedVersion },
      options,
    );
    return response.data;
  }

  async restoreProject(
    projectId: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<ProjectDto> {
    const response = await this.send<{ data: ProjectDto }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/restore${this.queryString({}, options)}`,
      expectedVersion === undefined ? {} : { expectedVersion },
      options,
    );
    return response.data;
  }

  async listStatuses(
    projectId: string,
    query: Partial<ListStatusesQuery> = {},
    options: RequestOptions = {},
  ): Promise<WorkflowStatusDto[]> {
    const response = await this.send<WorkflowStatusListResponse>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/statuses${this.queryString(query, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async createStatus(
    projectId: string,
    body: CreateStatusRequest,
    options: RequestOptions = {},
  ): Promise<WorkflowStatusDto> {
    const response = await this.send<WorkflowStatusResponse>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/statuses${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async updateStatus(
    statusId: string,
    body: UpdateStatusRequest,
    options: RequestOptions = {},
  ): Promise<WorkflowStatusDto> {
    const response = await this.send<WorkflowStatusResponse>(
      "PATCH",
      `/statuses/${encodeURIComponent(statusId)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async reorderStatus(
    statusId: string,
    body: ReorderStatusRequest,
    options: RequestOptions = {},
  ): Promise<WorkflowStatusDto> {
    const response = await this.send<WorkflowStatusResponse>(
      "POST",
      `/statuses/${encodeURIComponent(statusId)}/reorder${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async archiveStatus(
    statusId: string,
    body: ArchiveStatusRequest,
    options: RequestOptions = {},
  ): Promise<WorkflowStatusDto> {
    const response = await this.send<WorkflowStatusResponse>(
      "POST",
      `/statuses/${encodeURIComponent(statusId)}/archive${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async createProject(
    body: CreateProjectRequest,
    options: RequestOptions = {},
  ): Promise<ProjectDetailDto> {
    const response = await this.send<ProjectResponse>(
      "POST",
      `/projects${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async getProject(
    projectId: string,
    options: RequestOptions = {},
  ): Promise<ProjectDetailDto> {
    const response = await this.send<ProjectResponse>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async getProjectBoard(
    projectId: string,
    query: Partial<ProjectBoardQuery> = {},
    options: RequestOptions = {},
  ): Promise<ProjectBoardResponse> {
    return this.send<ProjectBoardResponse>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/board${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async listProjectActivity(
    projectId: string,
    query: Partial<ActivityQuery> = {},
    options: RequestOptions = {},
  ): Promise<ActivityListResponse> {
    return this.send<ActivityListResponse>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/activity${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async getProjectFlow(
    projectId: string,
    query: Partial<FlowQuery> = {},
    options: RequestOptions = {},
  ): Promise<FlowSummaryDto> {
    const response = await this.send<FlowResponse>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/flow${this.queryString(query, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async listTasks(
    query: Partial<ListTasksQuery> = {},
    options: RequestOptions = {},
  ): Promise<TaskListResponse> {
    return this.send<TaskListResponse>(
      "GET",
      `/tasks${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async createTask(
    body: CreateTaskRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async getTask(idOrKey: string, options: RequestOptions = {}): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "GET",
      `/tasks/${encodeURIComponent(idOrKey)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  /** A task's immutable history by UUID or workspace key, newest first. */
  async listTaskActivity(
    idOrKey: string,
    query: Partial<ActivityQuery> = {},
    options: RequestOptions = {},
  ): Promise<ActivityListResponse> {
    return this.send<ActivityListResponse>(
      "GET",
      `/tasks/${encodeURIComponent(idOrKey)}/activity${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async updateTask(
    id: string,
    body: UpdateTaskRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "PATCH",
      `/tasks/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  /** Moves can start work; the result carries any in-progress limit warning (GAP-20). */
  async moveTask(
    id: string,
    body: MoveTaskRequest,
    options: RequestOptions = {},
  ): Promise<TaskCommandResult> {
    const response = await this.send<TaskCommandResponse>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/move${this.queryString({}, options)}`,
      body,
      options,
    );
    return { task: response.data, warnings: response.warnings ?? [] };
  }

  /**
   * Bulk operations in one server transaction (spec 10.4). Results come back in request
   * order; a failure anywhere rolls the whole batch back and the error names the entry.
   */
  async batchTasks(
    body: BatchTasksRequest,
    options: RequestOptions = {},
  ): Promise<BatchTasksResult> {
    const response = await this.send<BatchTasksResponse>(
      "POST",
      `/tasks/batch${this.queryString({}, options)}`,
      body,
      options,
    );
    return { data: response.data, warnings: response.warnings ?? [] };
  }

  async reorderTask(
    id: string,
    body: ReorderTaskRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/reorder${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  /** A blocked task completes only with `acknowledgeBlocked` (spec 8.4). */
  async completeTask(
    id: string,
    body: CompleteTaskRequest = {},
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/complete${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async reopenTask(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskCommandResult> {
    const response = await this.send<TaskCommandResponse>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/reopen${this.queryString({}, options)}`,
      expectedVersion === undefined ? {} : { expectedVersion },
      options,
    );
    return { task: response.data, warnings: response.warnings ?? [] };
  }

  /** Move a repeating task on to its next occurrence without completing it (GAP-12). */
  async skipOccurrence(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/skip${this.queryString({}, options)}`,
      expectedVersion === undefined ? {} : { expectedVersion },
      options,
    );
    return response.data;
  }

  async setTaskParent(
    id: string,
    body: SetTaskParentRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/parent${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async clearTaskParent(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "DELETE",
      `/tasks/${encodeURIComponent(id)}/parent${this.queryString({ expectedVersion }, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  /** `taskId` is the source of a `blocks` relation; `related_to` is symmetric. */
  async addTaskRelation(
    taskId: string,
    body: AddTaskRelationRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(taskId)}/relations${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async removeTaskRelation(
    taskId: string,
    relationId: string,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "DELETE",
      `/tasks/${encodeURIComponent(taskId)}/relations/${encodeURIComponent(relationId)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async setTaskBlocked(
    id: string,
    body: SetTaskBlockedRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/blocked${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async clearTaskBlocked(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "DELETE",
      `/tasks/${encodeURIComponent(id)}/blocked${this.queryString({ expectedVersion }, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async deleteTask(id: string, options: RequestOptions = {}): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "DELETE",
      `/tasks/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  /**
   * `expectedVersion` is what makes an undo of a delete safe: if the task changed while
   * the toast was open, the restore is refused rather than overwriting that change.
   */
  async restoreTask(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/restore${this.queryString({ expectedVersion }, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  /** Add a task to My Day; the date defaults to the workspace's current day. */
  async addTaskToDay(
    id: string,
    body: AddTaskToDayRequest = {},
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/today${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async removeTaskFromDay(
    id: string,
    date: string,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "DELETE",
      `/tasks/${encodeURIComponent(id)}/today/${encodeURIComponent(date)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async getBoardView(
    query: Partial<BoardViewQuery> = {},
    options: RequestOptions = {},
  ): Promise<BoardViewResponse> {
    return this.send<BoardViewResponse>(
      "GET",
      `/views/board${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async getTodayView(
    query: Partial<TodayViewQuery> = {},
    options: RequestOptions = {},
  ): Promise<TodayViewResponse> {
    return this.send<TodayViewResponse>(
      "GET",
      `/views/today${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async getCalendarView(
    query: CalendarViewQuery,
    options: RequestOptions = {},
  ): Promise<CalendarViewResponse> {
    return this.send<CalendarViewResponse>(
      "GET",
      `/views/calendar${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async getCalendarFeedStatus(
    options: RequestOptions = {},
  ): Promise<CalendarFeedStatus> {
    const result = await this.send<{ data: CalendarFeedStatus }>(
      "GET",
      `/me/calendar-feed${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return result.data;
  }

  async createCalendarFeed(options: RequestOptions = {}): Promise<CalendarFeedDto> {
    const result = await this.send<{ data: CalendarFeedDto }>(
      "POST",
      `/me/calendar-feed${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return result.data;
  }

  async revokeCalendarFeed(options: RequestOptions = {}): Promise<void> {
    await this.send<void>(
      "DELETE",
      `/me/calendar-feed${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async getUpcomingView(
    query: Partial<UpcomingViewQuery> = {},
    options: RequestOptions = {},
  ): Promise<UpcomingViewResponse> {
    return this.send<UpcomingViewResponse>(
      "GET",
      `/views/upcoming${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  /** Full-text search with the operator grammar; a page of task hits plus project hits. */
  async search(
    query: Partial<SearchQuery> & { q: string },
    options: RequestOptions = {},
  ): Promise<SearchResponse> {
    return this.send<SearchResponse>(
      "GET",
      `/search${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async listSavedViews(options: RequestOptions = {}): Promise<SavedViewListResponse> {
    return this.send<SavedViewListResponse>(
      "GET",
      `/views/saved${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async createSavedView(
    body: CreateSavedViewRequest,
    options: RequestOptions = {},
  ): Promise<SavedViewDto> {
    const response = await this.send<{ data: SavedViewDto }>(
      "POST",
      `/views/saved${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async updateSavedView(
    id: string,
    body: UpdateSavedViewRequest,
    options: RequestOptions = {},
  ): Promise<SavedViewDto> {
    const response = await this.send<{ data: SavedViewDto }>(
      "PATCH",
      `/views/saved/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async reorderSavedView(
    id: string,
    body: ReorderSavedViewRequest,
    options: RequestOptions = {},
  ): Promise<SavedViewDto> {
    const response = await this.send<{ data: SavedViewDto }>(
      "POST",
      `/views/saved/${encodeURIComponent(id)}/reorder${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async deleteSavedView(id: string, options: RequestOptions = {}): Promise<void> {
    await this.send<void>(
      "DELETE",
      `/views/saved/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async listTags(options: RequestOptions = {}): Promise<TagListResponse> {
    return this.send<TagListResponse>(
      "GET",
      `/tags${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async createTag(
    body: CreateTagRequest,
    options: RequestOptions = {},
  ): Promise<TagDto> {
    const response = await this.send<{ data: TagDto }>(
      "POST",
      `/tags${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async updateTag(
    id: string,
    body: UpdateTagRequest,
    options: RequestOptions = {},
  ): Promise<TagDto> {
    const response = await this.send<{ data: TagDto }>(
      "PATCH",
      `/tags/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async deleteTag(id: string, options: RequestOptions = {}): Promise<void> {
    await this.send<void>(
      "DELETE",
      `/tags/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async addTaskTag(
    taskId: string,
    tagId: string,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async removeTaskTag(
    taskId: string,
    tagId: string,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "DELETE",
      `/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async listFields(options: RequestOptions = {}): Promise<FieldListResponse> {
    return this.send<FieldListResponse>(
      "GET",
      `/fields${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async createField(
    body: CreateFieldRequest,
    options: RequestOptions = {},
  ): Promise<FieldDefinitionDto> {
    const response = await this.send<{ data: FieldDefinitionDto }>(
      "POST",
      `/fields${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async updateField(
    id: string,
    body: UpdateFieldRequest,
    options: RequestOptions = {},
  ): Promise<FieldDefinitionDto> {
    const response = await this.send<{ data: FieldDefinitionDto }>(
      "PATCH",
      `/fields/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async deleteField(id: string, options: RequestOptions = {}): Promise<void> {
    await this.send<void>(
      "DELETE",
      `/fields/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  async listNotifications(
    query: Partial<ListNotificationsQuery> = {},
    options: RequestOptions = {},
  ): Promise<NotificationListResponse> {
    return this.send<NotificationListResponse>(
      "GET",
      `/notifications${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async markNotificationRead(
    id: string,
    options: RequestOptions = {},
  ): Promise<NotificationDto> {
    const response = await this.send<{ data: NotificationDto }>(
      "POST",
      `/notifications/${encodeURIComponent(id)}/read${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  /** "Remind me in an hour": reads the notification and re-arms the task's reminder. */
  async snoozeNotification(
    id: string,
    options: RequestOptions = {},
  ): Promise<NotificationDto> {
    const response = await this.send<{ data: NotificationDto }>(
      "POST",
      `/notifications/${encodeURIComponent(id)}/snooze${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async getNotificationPreferences(
    options: RequestOptions = {},
  ): Promise<NotificationPreferencesDto> {
    const response = await this.send<{ data: NotificationPreferencesDto }>(
      "GET",
      `/me/notification-preferences${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async updateNotificationPreferences(
    body: UpdateNotificationPreferencesRequest,
    options: RequestOptions = {},
  ): Promise<NotificationPreferencesDto> {
    const response = await this.send<{ data: NotificationPreferencesDto }>(
      "PATCH",
      `/me/notification-preferences${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  /** Whether this deployment can send push, and the key a browser subscribes with. */
  async getPushConfig(options: RequestOptions = {}): Promise<PushConfigDto> {
    const response = await this.send<{ data: PushConfigDto }>(
      "GET",
      "/me/push-config",
      undefined,
      options,
    );
    return response.data;
  }

  async addPushSubscription(
    body: PushSubscriptionRequest,
    options: RequestOptions = {},
  ): Promise<PushSubscriptionDto> {
    const response = await this.send<{ data: PushSubscriptionDto }>(
      "POST",
      "/me/push-subscriptions",
      body,
      options,
    );
    return response.data;
  }

  async removePushSubscription(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<void> {
    const params = new URLSearchParams({ endpoint });
    await this.send<void>(
      "DELETE",
      `/me/push-subscriptions?${params.toString()}`,
      undefined,
      options,
    );
  }

  async listRules(options: RequestOptions = {}): Promise<{ data: RuleDto[] }> {
    return this.send(
      "GET",
      `/rules${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }
  async createRule(
    body: CreateRuleRequest,
    options: RequestOptions = {},
  ): Promise<RuleDto> {
    return (
      await this.send<{ data: RuleDto }>(
        "POST",
        `/rules${this.queryString({}, options)}`,
        body,
        options,
      )
    ).data;
  }
  async updateRule(
    id: string,
    body: UpdateRuleRequest,
    options: RequestOptions = {},
  ): Promise<RuleDto> {
    return (
      await this.send<{ data: RuleDto }>(
        "PATCH",
        `/rules/${encodeURIComponent(id)}${this.queryString({}, options)}`,
        body,
        options,
      )
    ).data;
  }
  async deleteRule(id: string, options: RequestOptions = {}): Promise<void> {
    return this.send(
      "DELETE",
      `/rules/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }
  async listRuleRuns(
    id: string,
    options: RequestOptions = {},
  ): Promise<{ data: RuleRunDto[] }> {
    return this.send(
      "GET",
      `/rules/${encodeURIComponent(id)}/runs${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }
  async testRule(
    id: string,
    taskId: string,
    options: RequestOptions = {},
  ): Promise<RuleTestResult> {
    return (
      await this.send<{ data: RuleTestResult }>(
        "POST",
        `/rules/${encodeURIComponent(id)}/test${this.queryString({}, options)}`,
        { taskId },
        options,
      )
    ).data;
  }

  /** Webhook endpoints (GAP-18). The secret comes back from `createWebhook` only. */
  async listWebhooks(
    query: { limit?: number; cursor?: string } = {},
    options: RequestOptions = {},
  ): Promise<WebhookSubscriptionListResponse> {
    return this.send<WebhookSubscriptionListResponse>(
      "GET",
      `/webhooks${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async createWebhook(
    body: CreateWebhookRequest,
    options: RequestOptions = {},
  ): Promise<CreatedWebhookSubscriptionDto> {
    const response = await this.send<{ data: CreatedWebhookSubscriptionDto }>(
      "POST",
      `/webhooks${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async updateWebhook(
    id: string,
    body: UpdateWebhookRequest,
    options: RequestOptions = {},
  ): Promise<WebhookSubscriptionDto> {
    const response = await this.send<{ data: WebhookSubscriptionDto }>(
      "PATCH",
      `/webhooks/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
  }

  async deleteWebhook(id: string, options: RequestOptions = {}): Promise<void> {
    await this.send<void>(
      "DELETE",
      `/webhooks/${encodeURIComponent(id)}${this.queryString({}, options)}`,
      undefined,
      options,
    );
  }

  /** Sends one delivery now. A refused delivery is a recorded failure, not an error. */
  async testWebhook(
    id: string,
    options: RequestOptions = {},
  ): Promise<WebhookDeliveryDto> {
    const response = await this.send<{ data: WebhookDeliveryDto }>(
      "POST",
      `/webhooks/${encodeURIComponent(id)}/test${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  async listWebhookDeliveries(
    id: string,
    query: Partial<ListWebhookDeliveriesQuery> = {},
    options: RequestOptions = {},
  ): Promise<WebhookDeliveryListResponse> {
    return this.send<WebhookDeliveryListResponse>(
      "GET",
      `/webhooks/${encodeURIComponent(id)}/deliveries${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  async retryWebhookDelivery(
    id: string,
    deliveryId: string,
    options: RequestOptions = {},
  ): Promise<WebhookDeliveryDto> {
    const response = await this.send<{ data: WebhookDeliveryDto }>(
      "POST",
      `/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/retry${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  /**
   * The whole workspace as the versioned archive of spec 30.2 (GAP-07). Parsed here
   * rather than streamed: a caller that wants the raw file downloads the URL directly.
   */
  async exportWorkspace(
    query: Partial<ExportWorkspaceQuery> = {},
    options: RequestOptions = {},
  ): Promise<WorkspaceExport> {
    return this.send<WorkspaceExport>(
      "GET",
      `/exports/workspace.json${this.queryString(query, options)}`,
      undefined,
      options,
    );
  }

  /** Tasks as CSV text, through the same filters as `listTasks`. */
  async exportTasksCsv(
    query: Partial<ExportTasksCsvQuery> = {},
    options: RequestOptions = {},
  ): Promise<string> {
    return this.sendText(
      "GET",
      `/exports/tasks.csv${this.queryString(query, options)}`,
      options,
    );
  }

  /**
   * Import a Trello board's JSON or a CSV as a new project. `dryRun` returns the same
   * preview without writing anything, so a caller can show it before committing.
   */
  async importData(
    source: ImportSource,
    body: ImportRequest & { readonly dryRun?: boolean },
    options: RequestOptions = {},
  ): Promise<ImportResultDto> {
    const { dryRun, ...payload } = body;
    const response = await this.send<{ data: ImportResultDto }>(
      "POST",
      `/imports/${encodeURIComponent(source)}${this.queryString(
        dryRun ? { dryRun: true } : {},
        options,
      )}`,
      payload,
      options,
    );
    return response.data;
  }

  private queryString(query: Record<string, unknown>, options: RequestOptions): string {
    const params = new URLSearchParams();
    const workspaceId = options.workspaceId ?? this.options.workspaceId;
    if (workspaceId) params.set("workspaceId", workspaceId);

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      // Typed custom-field filters are one dotted parameter each (GAP-24).
      if (key === "fields" && Array.isArray(value)) {
        for (const filter of value as FieldFilterDto[]) {
          params.set(`field.${filter.key}`, fieldFilterValue(filter));
        }
        continue;
      }
      params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : "";
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (this.options.apiKey) {
      headers.set("authorization", `Bearer ${this.options.apiKey}`);
    }
    if (this.options.requestId) headers.set("x-request-id", this.options.requestId);
    if (options.idempotencyKey) {
      headers.set("idempotency-key", options.idempotencyKey);
    }

    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      // The browser needs the session cookie; a bearer token is unaffected by this.
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** A text response — the CSV export — rather than the JSON envelope. */
  private async sendText(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<string> {
    const headers = new Headers({ accept: "text/csv" });
    if (this.options.apiKey) {
      headers.set("authorization", `Bearer ${this.options.apiKey}`);
    }
    if (this.options.requestId) headers.set("x-request-id", this.options.requestId);

    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw await this.toError(response);
    return response.text();
  }

  private async toError(response: Response): Promise<ApiClientError> {
    let payload: ErrorResponse | undefined;
    try {
      payload = (await response.json()) as ErrorResponse;
    } catch {
      // A non-JSON error body (a proxy error page, for instance) still has to surface as
      // a typed failure rather than a parse exception.
    }

    const error = payload?.error;
    return new ApiClientError(
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      error?.details,
      error?.requestId ?? response.headers.get("x-request-id") ?? undefined,
    );
  }
}

/**
 * The value half of a `field.<key>=` parameter: `<operator>[:<value>]`, with `between`
 * spelled `low..high`. The server parses the same shape (GAP-24).
 */
function fieldFilterValue(filter: FieldFilterDto): string {
  if (filter.op === "empty") return "empty";
  if (filter.op === "between") return `between:${filter.value}..${filter.upper}`;
  return `${filter.op}:${filter.value}`;
}
