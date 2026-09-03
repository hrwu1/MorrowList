import type { ActivityListResponse, ActivityQuery } from "@morrowlist/contracts";
import { DomainError } from "@morrowlist/domain";

import type {
  ActivityEvent,
  Page,
  TransactionContext,
  UnitOfWork,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { decodeCursor, encodeCursor } from "../shared/cursor.js";

import { toActivityEntryDto } from "./mappers.js";

/**
 * Activity queries (ACT-001, spec 10.2). Read-only and paginated: history is written by
 * the commands that change things and is never edited here.
 */

export interface ActivityServiceOptions {
  readonly unitOfWork: UnitOfWork;
  /** Signs pagination cursors so a client cannot forge a position (spec 20.6). */
  readonly cursorSecret: string;
}

export class ActivityService {
  private readonly unitOfWork: UnitOfWork;
  private readonly cursorSecret: string;

  constructor(options: ActivityServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.cursorSecret = options.cursorSecret;
  }

  /**
   * One task's history by UUID or workspace key. A trashed task still answers: its
   * history is how a user works out why it is in the Trash.
   */
  async listForTask(
    context: ActorContext,
    workspaceId: string,
    idOrKey: string,
    query: ActivityQuery,
  ): Promise<ActivityListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.activityRead);

    return this.unitOfWork.execute(async (tx) => {
      const task = await this.resolveTask(tx, workspaceId, idOrKey);
      const page = await tx.activity.listForAggregate(workspaceId, "task", task.id, {
        limit: query.limit,
        after: this.anchorOf(query),
      });
      return this.toResponse(page);
    });
  }

  /** A project's own events plus those of the tasks currently in it. */
  async listForProject(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    query: ActivityQuery,
  ): Promise<ActivityListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.activityRead);

    return this.unitOfWork.execute(async (tx) => {
      const project = await tx.projects.findById(workspaceId, projectId);
      if (!project) {
        throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
      }
      const page = await tx.activity.listForProject(workspaceId, projectId, {
        limit: query.limit,
        after: this.anchorOf(query),
      });
      return this.toResponse(page);
    });
  }

  private anchorOf(query: ActivityQuery): string | undefined {
    return query.cursor ? decodeCursor(query.cursor, this.cursorSecret).i : undefined;
  }

  private toResponse(page: Page<ActivityEvent>): ActivityListResponse {
    const last = page.items.at(-1);
    return {
      data: page.items.map(toActivityEntryDto),
      page: {
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && last
            ? encodeCursor(
                { k: last.createdAt.toISOString(), i: last.id },
                this.cursorSecret,
              )
            : null,
      },
    };
  }

  private async resolveTask(
    tx: TransactionContext,
    workspaceId: string,
    idOrKey: string,
  ) {
    const numeric = /^\d+$/.test(idOrKey)
      ? Number(idOrKey)
      : /-(\d+)$/.exec(idOrKey)?.[1];
    const task =
      numeric === undefined
        ? await tx.tasks.findById(workspaceId, idOrKey)
        : await tx.tasks.findByNumber(workspaceId, Number(numeric));
    if (!task) {
      throw new DomainError("TASK_NOT_FOUND", "Task not found.", { idOrKey });
    }
    return task;
  }
}
