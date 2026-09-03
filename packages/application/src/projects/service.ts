import type {
  CreateProjectRequest,
  ProjectBoardQuery,
  ProjectBoardResponse,
  ProjectDetailDto,
  ProjectListResponse,
} from "@morrowlist/contracts";
import { PROJECT_EVENTS } from "@morrowlist/contracts";
import {
  DEFAULT_WORKFLOW,
  DomainError,
  ValidationError,
  ranksBetween,
  systemClock,
  toLocalDate,
  uuidv7,
  type Clock,
  type WorkflowStatus,
} from "@morrowlist/domain";

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

import { toProjectDto, toWorkflowStatusDto } from "./mappers.js";

export interface ProjectServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export interface WorkspaceProjectRequest {
  readonly workspaceId: string;
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
    request: WorkspaceProjectRequest,
  ): Promise<ProjectListResponse> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.projectsRead);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, request.workspaceId);
      const projects = await tx.projects.listByWorkspace(request.workspaceId);
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
      await this.requireWorkspace(tx, request.workspaceId);
      const existing = await tx.projects.listByWorkspace(request.workspaceId, {
        includeArchived: true,
      });
      const name = normalizeProjectName(request.name);
      if (
        existing.some((project) => project.name.toLowerCase() === name.toLowerCase())
      ) {
        throw new ValidationError("A project with this name already exists.", {
          field: "name",
          name,
        });
      }

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
      await this.requireWorkspace(tx, workspaceId);
      const project = await this.requireActiveProject(tx, workspaceId, projectId);
      const statuses = await tx.statuses.listByProject(project.id);
      return {
        project: toProjectDto(project),
        statuses: statuses.map(toWorkflowStatusDto),
      };
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
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const project = await this.requireActiveProject(tx, workspaceId, projectId);
      const statuses = await tx.statuses.listByProject(project.id);
      const tasks = await tx.tasks.listBoard({
        workspaceId,
        projectId,
        limit: Math.min(query.limit ?? BOARD_TASK_LIMIT, BOARD_TASK_LIMIT),
      });
      // Cards show the My Day indicator (spec 9.5); one query covers the whole board.
      const plans = await tx.dayPlans.listForTasks(
        tasks.items.map((task) => task.id),
        toLocalDate(this.clock.now(), workspace.timezone),
      );

      return {
        data: {
          project: toProjectDto(project),
          statuses: statuses.map(toWorkflowStatusDto),
          tasks: tasks.items.map((task) =>
            toTaskDto(task, workspace.taskKeyPrefix, plans.get(task.id) ?? []),
          ),
        },
        page: { hasMore: tasks.hasMore, truncated: tasks.truncated },
      };
    });
  }

  private async requireWorkspace(tx: TransactionContext, workspaceId: string) {
    const workspace = await tx.workspaces.findById(workspaceId);
    if (!workspace) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
        workspaceId,
      });
    }
    return workspace;
  }

  private async requireActiveProject(
    tx: TransactionContext,
    workspaceId: string,
    projectId: string,
  ): Promise<Project> {
    const project = await tx.projects.findById(workspaceId, projectId);
    if (!project || project.archivedAt !== null) {
      throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
    }
    return project;
  }
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
