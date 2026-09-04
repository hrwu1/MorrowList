import type {
  SearchProjectResultDto,
  SearchQuery,
  SearchResponse,
  SearchTaskResultDto,
} from "@morrowlist/contracts";
import { SEARCH_PROJECT_LIMIT } from "@morrowlist/contracts";
import {
  DomainError,
  matchRanges,
  parseSearchQuery,
  parseTaskKey,
  searchTerms,
  systemClock,
  tagLookupKey,
  toLocalDate,
  type Clock,
  type Task,
} from "@morrowlist/domain";

import type {
  TaskFilter,
  TransactionContext,
  UnitOfWork,
  Workspace,
} from "../ports/index.js";
import { toProjectDto } from "../projects/mappers.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { decodeCursor, encodeCursor } from "../shared/cursor.js";
import { toTaskDto } from "../tasks/mappers.js";

export interface SearchServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
  readonly cursorSecret: string;
}

export interface WorkspaceSearchRequest {
  readonly workspaceId: string;
}

/**
 * Search (spec 9.8, 19.2 SearchTasks). One transaction: the query grammar is parsed,
 * operators are merged over the explicit filters, a task key is resolved first, and
 * the task page, its tag and progress projections, and the project name hits are read
 * together. Match ranges are offsets computed here; no HTML leaves the server.
 */
export class SearchService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;
  private readonly cursorSecret: string;

  constructor(options: SearchServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
    this.cursorSecret = options.cursorSecret;
  }

  async search(
    context: ActorContext,
    request: SearchQuery & WorkspaceSearchRequest,
  ): Promise<SearchResponse> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.tasksRead);

    const parsed = parseSearchQuery(request.q);
    const terms = searchTerms(parsed.text);
    const after = request.cursor
      ? decodeCursor(request.cursor, this.cursorSecret).i
      : undefined;

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, request.workspaceId);
      const today = toLocalDate(this.clock.now(), workspace.timezone);

      // Operators in the query override the same explicit filter (spec 9.8).
      const filter: TaskFilter = {
        workspaceId: workspace.id,
        projectId: request.projectId,
        statusId: request.statusId,
        priority: parsed.filters.priority ?? request.priority,
        tagId: request.tagId,
        inboxOnly: parsed.filters.inbox ?? request.inbox,
        isCompleted: parsed.filters.isCompleted ?? request.isCompleted,
        isBlocked: parsed.filters.isBlocked ?? request.isBlocked,
        includeSubtasks: request.includeSubtasks,
        due: parsed.filters.due ?? request.due,
        today,
      };

      if (parsed.filters.tag !== undefined) {
        const tag = await tx.tags.findByNormalizedName(
          workspace.id,
          tagLookupKey(parsed.filters.tag),
        );
        // An unknown tag name matches nothing rather than everything.
        if (!tag) return { data: { tasks: [], projects: [] }, page: emptyPage() };
        Object.assign(filter, { tagId: tag.id });
      }

      const page = await tx.tasks.search(
        { ...filter, terms },
        {
          limit: request.limit,
          after,
        },
      );

      // A task key such as ML-12 is an exact hit and leads the first page (spec 9.8).
      const keyed = after ? null : await this.byKey(tx, workspace, parsed.text);
      const items = keyed
        ? [keyed, ...page.items.filter((task) => task.id !== keyed.id)]
        : [...page.items];

      const ids = items.map((task) => task.id);
      const [plans, progress, tags, projects] = await Promise.all([
        tx.dayPlans.listForTasks(ids, today),
        tx.tasks.childSummary(workspace.id, ids),
        tx.tasks.tagsFor(workspace.id, ids),
        after || terms.length === 0
          ? Promise.resolve([])
          : tx.projects.listByWorkspace(workspace.id),
      ]);

      const tasks: SearchTaskResultDto[] = items.map((task) => ({
        task: toTaskDto(
          task,
          workspace.taskKeyPrefix,
          plans.get(task.id) ?? [],
          progress.get(task.id) ?? null,
          tags.get(task.id) ?? [],
        ),
        matches: {
          title: matchRanges(task.title, terms),
          description: matchRanges(task.descriptionMd, terms),
        },
      }));

      const projectHits: SearchProjectResultDto[] = projects
        .flatMap((project) => {
          const matches = matchRanges(project.name, terms);
          return matches.length > 0
            ? [{ project: toProjectDto(project), matches }]
            : [];
        })
        .slice(0, SEARCH_PROJECT_LIMIT);

      const last = page.items.at(-1);
      return {
        data: { tasks, projects: projectHits },
        page: {
          hasMore: page.hasMore,
          nextCursor:
            page.hasMore && last
              ? encodeCursor({ k: "search", i: last.id }, this.cursorSecret)
              : null,
        },
      };
    });
  }

  /** The live task a query names by key, when the prefix is this workspace's. */
  private async byKey(
    tx: TransactionContext,
    workspace: Workspace,
    text: string,
  ): Promise<Task | null> {
    const key = parseTaskKey(text);
    if (!key || key.prefix !== workspace.taskKeyPrefix.toUpperCase()) return null;
    const task = await tx.tasks.findByNumber(workspace.id, key.taskNumber);
    return task && task.deletedAt === null ? task : null;
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
}

function emptyPage() {
  return { nextCursor: null, hasMore: false };
}
