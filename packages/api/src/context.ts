import type {
  ActivityService,
  ActorContext,
  ProjectService,
  TagService,
  TaskService,
  UnitOfWork,
  ViewService,
  WorkflowService,
} from "@morrowlist/application";
import type { AuthPort } from "@morrowlist/auth";
import type { Logger, Metrics } from "@morrowlist/observability";

/**
 * The composition root hands the API everything it needs; the API constructs nothing
 * itself. This keeps routes testable with fakes and keeps wiring in one place.
 */
export interface ApiDependencies {
  readonly auth: AuthPort;
  readonly unitOfWork: UnitOfWork;
  readonly projectService: ProjectService;
  readonly workflowService: WorkflowService;
  readonly taskService: TaskService;
  readonly activityService: ActivityService;
  readonly viewService: ViewService;
  readonly tagService: TagService;
  readonly logger: Logger;
  readonly metrics?: Metrics;
  /** Readiness probe backing `GET /ready` (spec FND-006). */
  readonly checkHealth: () => Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  }>;
}

/** Per-request values attached by middleware and read by routes. */
export interface RequestVariables {
  requestId: string;
  logger: Logger;
  actor: ActorContext;
}

export interface ApiEnv {
  Bindings: Record<string, never>;
  Variables: RequestVariables;
}
