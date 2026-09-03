import type {
  ActivityListResponse,
  ActivityQuery,
  CreateProjectRequest,
  CreateTaskRequest,
  ErrorCode,
  ErrorResponse,
  ListTasksQuery,
  MeResponse,
  MoveTaskRequest,
  ProjectBoardQuery,
  ProjectBoardResponse,
  ProjectDetailDto,
  ProjectListResponse,
  ProjectResponse,
  ReorderTaskRequest,
  TaskDto,
  TaskListResponse,
  UpdateTaskRequest,
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

  async me(options: RequestOptions = {}): Promise<MeResponse["data"]> {
    const body = await this.send<MeResponse>("GET", "/me", undefined, options);
    return body.data;
  }

  async listProjects(options: RequestOptions = {}): Promise<ProjectListResponse> {
    return this.send<ProjectListResponse>(
      "GET",
      `/projects${this.queryString({}, options)}`,
      undefined,
      options,
    );
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

  async moveTask(
    id: string,
    body: MoveTaskRequest,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/move${this.queryString({}, options)}`,
      body,
      options,
    );
    return response.data;
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

  async completeTask(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/complete${this.queryString({}, options)}`,
      expectedVersion === undefined ? {} : { expectedVersion },
      options,
    );
    return response.data;
  }

  async reopenTask(
    id: string,
    expectedVersion?: number,
    options: RequestOptions = {},
  ): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/reopen${this.queryString({}, options)}`,
      expectedVersion === undefined ? {} : { expectedVersion },
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

  async restoreTask(id: string, options: RequestOptions = {}): Promise<TaskDto> {
    const response = await this.send<{ data: TaskDto }>(
      "POST",
      `/tasks/${encodeURIComponent(id)}/restore${this.queryString({}, options)}`,
      undefined,
      options,
    );
    return response.data;
  }

  private queryString(query: Record<string, unknown>, options: RequestOptions): string {
    const params = new URLSearchParams();
    const workspaceId = options.workspaceId ?? this.options.workspaceId;
    if (workspaceId) params.set("workspaceId", workspaceId);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
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
