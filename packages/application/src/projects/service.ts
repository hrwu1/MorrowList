import { PROJECT_EVENTS } from "@morrowlist/contracts";
import type {
  CreateProjectRequest,
  ListProjectsQuery,
  ProjectBoardQuery,
  ProjectBoardResponse,
  ProjectDetailDto,
  ProjectDto,
  ProjectListResponse,
  UpdateProjectRequest, BoardPlacementDto 
} from "@morrowlist/contracts";
import {
  DEFAULT_WORKFLOW,
  ValidationError,
  ranksBetween,
  systemClock,
  toLocalDate,
  uuidv7,
  type Clock,
  type WorkflowStatus,
} from "@morrowlist/domain";

import { buildLanes, statusColumnKey } from "../board/index.js";
import { cardFlowFields } from "../flow/service.js";
import {
  BOARD_TASK_LIMIT,
  type Project,
  type TransactionContext,
  type UnitOfWork,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";
import { toTaskDto } from "../tasks/mappers.js";
import { slugify } from "../workspace/bootstrap.js";

import {
  assertVersion,
  requireActiveProject,
  requireProject,
  requireWorkspace,
  versionConflict,
} from "./lookup.js";
import { toProjectDto, toWorkflowStatusDto } from "./mappers.js";

export interface ProjectServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export interface WorkspaceProjectRequest {
  readonly workspaceId: string;
}

/**
 * Case-insensitive name uniqueness within the workspace (spec 18.2), ignoring the
 * project being edited so a rename to its own name in another case is allowed.
 */
function assertProjectNameAvailable(
  name: string,
  existing: readonly Project[],
  ownId: string | null,
): void {
  if (
    existing.some(
      (project) =>
        project.id !== ownId && project.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new ValidationError("A project with this name already exists.", {
      field: "name",
      name,
    });
  }
}

/**
 * Project and board use cases. Project creation owns the default workflow transaction so a
 * project can never be observed without its six usable statuses (spec 11.2, PRJ-001).
 */
export class ProjectService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: ProjectServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async list(
    context: ActorContext,
    request: WorkspaceProjectRequest & Partial<ListProjectsQuery>,
  ): Promise<ProjectListResponse> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.projectsRead);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, request.workspaceId);
      const projects = await tx.projects.listByWorkspace(request.workspaceId, {
        includeArchived: request.includeArchived ?? false,
      });
      return {
        data: projects.map(toProjectDto),
        page: { nextCursor: null, hasMore: false },
      };
    });
  }

  async create(
    context: ActorContext,
    request: CreateProjectRequest & WorkspaceProjectRequest,
  ): Promise<ProjectDetailDto> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, request.workspaceId);
      const existing = await tx.projects.listByWorkspace(request.workspaceId, {
        includeArchived: true,
      });
      const name = normalizeProjectName(request.name);
      assertProjectNameAvailable(name, existing, null);

      const now = this.clock.now();
      const project: Project = {
        id: uuidv7(),
        workspaceId: request.workspaceId,
        name,
        slug: uniqueProjectSlug(slugify(name), existing),
        descriptionMd: normalizeOptionalText(request.descriptionMd),
        colorToken: normalizeColorToken(request.colorToken),
        icon: normalizeOptionalText(request.icon),
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const statuses = buildDefaultWorkflow(project.id);

      await tx.projects.insert(project);
      await tx.statuses.insertMany(statuses);
      await recordEvent(tx, context, this.clock, {
        workspaceId: project.workspaceId,
        aggregateType: "project",
        aggregateId: project.id,
        eventType: PROJECT_EVENTS.created,
        summary: `Created project ${project.name}`,
        payload: {
          projectId: project.id,
          name: project.name,
          statusIds: statuses.map((status) => status.id),
        },
      });

      return {
        project: toProjectDto(project),
        statuses: statuses.map(toWorkflowStatusDto),
      };
    });
  }

  async get(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectDetailDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsRead);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const project = await requireActiveProject(tx, workspaceId, projectId);
      const statuses = await tx.statuses.listByProject(project.id);
      return {
        project: toProjectDto(project),
        statuses: statuses.map(toWorkflowStatusDto),
      };
    });
  }

  /** Edit name, description, colour, or icon; the slug and the workflow stay put. */
  async update(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    request: UpdateProjectRequest,
  ): Promise<ProjectDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const previous = await requireActiveProject(tx, workspaceId, projectId);
      assertVersion(previous, request.expectedVersion, "project");

      const name =
        request.name === undefined ? previous.name : normalizeProjectName(request.name);
      if (name !== previous.name) {
        const existing = await tx.projects.listByWorkspace(workspaceId, {
          includeArchived: true,
        });
        assertProjectNameAvailable(name, existing, previous.id);
      }

      const next: Project = {
        ...previous,
        name,
        descriptionMd:
          request.descriptionMd === undefined
            ? previous.descriptionMd
            : normalizeOptionalText(request.descriptionMd),
        colorToken:
          request.colorToken === undefined
            ? previous.colorToken
            : normalizeColorToken(request.colorToken),
        icon:
          request.icon === undefined
            ? previous.icon
            : normalizeOptionalText(request.icon),
        version: previous.version + 1,
        updatedAt: this.clock.now(),
      };
      if (Object.keys(projectChanges(next, previous)).length === 0) {
        // Nothing material changed: no version bump, no event.
        return toProjectDto(previous);
      }

      await this.persist(tx, context, next, previous, {
        eventType: PROJECT_EVENTS.updated,
        summary: `Updated project ${next.name}`,
      });
      return toProjectDto(next);
    });
  }

  /** Archive hides the project from navigation but keeps every task (spec 8.6). */
  async archive(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    expectedVersion?: number,
  ): Promise<ProjectDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const previous = await requireProject(tx, workspaceId, projectId);
      assertVersion(previous, expectedVersion, "project");
      if (previous.archivedAt !== null) return toProjectDto(previous);

      const now = this.clock.now();
      const next: Project = {
        ...previous,
        archivedAt: now,
        version: previous.version + 1,
        updatedAt: now,
      };
      await this.persist(tx, context, next, previous, {
        eventType: PROJECT_EVENTS.archived,
        summary: `Archived project ${previous.name}`,
      });
      return toProjectDto(next);
    });
  }

  async restore(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    expectedVersion?: number,
  ): Promise<ProjectDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const previous = await requireProject(tx, workspaceId, projectId);
      assertVersion(previous, expectedVersion, "project");
      if (previous.archivedAt === null) return toProjectDto(previous);

      const next: Project = {
        ...previous,
        archivedAt: null,
        version: previous.version + 1,
        updatedAt: this.clock.now(),
      };
      await this.persist(tx, context, next, previous, {
        eventType: PROJECT_EVENTS.restored,
        summary: `Restored project ${previous.name}`,
      });
      return toProjectDto(next);
    });
  }

  async board(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    query: Partial<ProjectBoardQuery> = {},
  ): Promise<ProjectBoardResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await requireWorkspace(tx, workspaceId);
      const project = await requireActiveProject(tx, workspaceId, projectId);
      const statuses = await tx.statuses.listByProject(project.id);
      const tasks = await tx.tasks.listBoard({
        workspaceId,
        projectId,
        limit: Math.min(query.limit ?? BOARD_TASK_LIMIT, BOARD_TASK_LIMIT),
        includeSubtasks: query.includeSubtasks ?? false,
        includeDeferred: query.includeDeferred ?? false,
        today: toLocalDate(this.clock.now(), workspace.timezone),
      });
      const boardTaskIds = tasks.items.map((task) => task.id);
      // Cards show the My Day indicator (spec 9.5), subtask progress, tag chips, the
      // blocked indicator (spec 29.3) and the flow fields (GAP-17); one query each
      // covers the whole board.
      const now = this.clock.now();
      const today = toLocalDate(now, workspace.timezone);
      const [plans, progress, tags, edges, flow] = await Promise.all([
        tx.dayPlans.listForTasks(boardTaskIds, today),
        tx.tasks.childSummary(workspaceId, boardTaskIds),
        tx.tasks.tagsFor(workspaceId, boardTaskIds),
        tx.tasks.relationsFor(workspaceId, boardTaskIds),
        cardFlowFields(tx, workspaceId, boardTaskIds, now),
      ]);
      const cards = tasks.items.map((task) =>
        toTaskDto(
          task,
          workspace.taskKeyPrefix,
          plans.get(task.id) ?? [],
          progress.get(task.id) ?? null,
          tags.get(task.id) ?? [],
          edges,
          flow.get(task.id) ?? { inStatusSince: null, ageDays: null },
        ),
      );

      // Swimlanes are the board's second axis (GAP-19); the columns stay this project's
      // workflow statuses, so the same rendering serves a plain board and a pivoted one.
      const swimlaneBy = query.swimlaneBy ?? "none";
      const parentIds = [
        ...new Set(
          cards.flatMap((card) => (card.parentTaskId ? [card.parentTaskId] : [])),
        ),
      ];
      const parents = await Promise.all(
        parentIds.map((id) => tx.tasks.findById(workspaceId, id)),
      );
      const { lanes, laneKeys } = buildLanes(swimlaneBy, cards, {
        projects: await tx.projects.listByWorkspace(workspaceId),
        parentTitles: new Map(
          parents.flatMap((parent) => (parent ? [[parent.id, parent.title]] : [])),
        ),
        today,
      });
      const placements: BoardPlacementDto[] = cards.flatMap((card) =>
        card.statusId
          ? [
              {
                taskId: card.id,
                columnKey: statusColumnKey(card.statusId),
                laneKey: laneKeys.get(card.id) as string,
              },
            ]
          : [],
      );

      return {
        data: {
          project: toProjectDto(project),
          statuses: statuses.map(toWorkflowStatusDto),
          tasks: cards,
          swimlaneBy,
          lanes: [...lanes],
          placements,
        },
        page: { hasMore: tasks.hasMore, truncated: tasks.truncated },
      };
    });
  }

  /** Persist with the version guard and record the activity and outbox rows. */
  private async persist(
    tx: TransactionContext,
    context: ActorContext,
    next: Project,
    previous: Project,
    event: { readonly eventType: string; readonly summary: string },
  ): Promise<void> {
    const persisted = await tx.projects.update(next, previous.version);
    if (!persisted) throw versionConflict(previous, "project");

    await recordEvent(tx, context, this.clock, {
      workspaceId: next.workspaceId,
      aggregateType: "project",
      aggregateId: next.id,
      eventType: event.eventType,
      summary: event.summary,
      payload: { projectId: next.id, changes: projectChanges(next, previous) },
    });
  }
}

const PROJECT_FIELDS = [
  "name",
  "descriptionMd",
  "colorToken",
  "icon",
  "archivedAt",
] as const satisfies readonly (keyof Project)[];

function projectChanges(
  next: Project,
  previous: Project,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of PROJECT_FIELDS) {
    const a = next[field];
    const b = previous[field];
    const changed =
      a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    if (changed) {
      changes[field] = {
        from: b instanceof Date ? b.toISOString() : b,
        to: a instanceof Date ? a.toISOString() : a,
      };
    }
  }
  return changes;
}

function buildDefaultWorkflow(projectId: string): WorkflowStatus[] {
  const ranks = ranksBetween(null, null, DEFAULT_WORKFLOW.length);
  return DEFAULT_WORKFLOW.map((template, index) => ({
    id: uuidv7(),
    projectId,
    name: template.name,
    category: template.category,
    rank: ranks[index] as string,
    colorToken: template.colorToken,
    wipLimit: null,
    isDefault: template.isDefault,
    policyMd: null,
    archivedAt: null,
    version: 1,
  }));
}

function normalizeProjectName(raw: string): string {
  const name = raw.normalize("NFC").trim();
  if (name.length === 0) {
    throw new ValidationError("Project name is required.", { field: "name" });
  }
  if ([...name].length > 100) {
    throw new ValidationError("Project name must be 100 characters or fewer.", {
      field: "name",
      maxLength: 100,
    });
  }
  return name;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeColorToken(value: string | undefined): string {
  return value?.trim() || "blue";
}

function uniqueProjectSlug(base: string, projects: readonly Project[]): string {
  const used = new Set(projects.map((project) => project.slug));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${uuidv7().slice(0, 8)}`;
}
