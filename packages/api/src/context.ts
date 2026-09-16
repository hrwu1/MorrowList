import type {
  IdempotencyService,
  CalDavService,
  CalendarFeedService,
  InboundEmailService,
  ActivityService,
  RuleService,
  ActorContext,
  FieldService,
  ExportService,
  FlowService,
  ImportService,
  NotificationService,
  ProjectService,
  SavedViewService,
  SearchService,
  TagService,
  TaskService,
  UnitOfWork,
  ViewService,
  WebhookService,
  WorkflowService,
  WorkspaceService,
} from "@morrowlist/application";
import type { AuthPort } from "@morrowlist/auth";
import type { Logger, Metrics } from "@morrowlist/observability";

/**
 * The composition root hands the API everything it needs; the API constructs nothing
 * itself. This keeps routes testable with fakes and keeps wiring in one place.
 */
export interface ApiDependencies {
  readonly idempotencyService: IdempotencyService;
  /** Encrypts replay envelopes; composition uses the configured application secret. */
  readonly idempotencySecret: string;
  readonly calendarFeedService: CalendarFeedService;
  readonly calDavService: CalDavService;
  readonly inboundEmailService: InboundEmailService;
  readonly auth: AuthPort;
  readonly unitOfWork: UnitOfWork;
  readonly workspaceService: WorkspaceService;
  readonly projectService: ProjectService;
  readonly workflowService: WorkflowService;
  readonly taskService: TaskService;
  readonly ruleService: RuleService;
  readonly activityService: ActivityService;
  readonly flowService: FlowService;
  readonly exportService: ExportService;
  readonly importService: ImportService;
  readonly viewService: ViewService;
  readonly tagService: TagService;
  readonly fieldService: FieldService;
  readonly searchService: SearchService;
  readonly savedViewService: SavedViewService;
  readonly notificationService: NotificationService;
  /**
   * The VAPID public key browsers subscribe with, or null when this deployment has no
   * push keys configured (GAP-13 step 7). Configuration, so it is a value rather than a
   * service: nothing in the application layer needs it.
   */
  readonly pushPublicKey?: string | null;
  readonly webhookService: WebhookService;
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
