import type {
  CreateTagRequest,
  TagDto,
  TagListResponse,
  UpdateTagRequest,
} from "@morrowlist/contracts";
import { TAG_EVENTS } from "@morrowlist/contracts";
import {
  DEFAULT_TAG_COLOR,
  DomainError,
  normalizeTagName,
  systemClock,
  tagLookupKey,
  toTagColorToken,
  uuidv7,
  type Clock,
  type Tag,
} from "@morrowlist/domain";

import type { TransactionContext, UnitOfWork } from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

import { toTagDto } from "./mappers.js";

export interface TagServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Tag use cases (spec 12.1, TASK-008). Names are unique per workspace case-insensitively;
 * deleting a tag removes its associations but never a task. Every mutation records an
 * activity row and an outbox event in the same transaction.
 */
export class TagService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: TagServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async list(context: ActorContext, workspaceId: string): Promise<TagListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tagsRead);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const [tags, counts] = await Promise.all([
        tx.tags.listByWorkspace(workspaceId),
        tx.tags.taskCounts(workspaceId),
      ]);
      return {
        data: tags.map((tag) => ({
          ...toTagDto(tag),
          taskCount: counts.get(tag.id) ?? 0,
        })),
      };
    });
  }

  async create(
    context: ActorContext,
    workspaceId: string,
    request: CreateTagRequest,
  ): Promise<TagDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tagsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const tag = await this.insertTag(tx, context, workspaceId, request);
      return toTagDto(tag);
    });
  }

  /**
   * Create a tag inside a caller's transaction, so a command that creates a tag and
   * attaches it (the CLI's `--create-tags`) commits or rolls back as one unit.
   */
  async insertTag(
    tx: TransactionContext,
    context: ActorContext,
    workspaceId: string,
    request: CreateTagRequest,
  ): Promise<Tag> {
    const name = normalizeTagName(request.name);
    const normalizedName = tagLookupKey(name);
    await this.assertNameFree(tx, workspaceId, normalizedName, null);

    const now = this.clock.now();
    const tag: Tag = {
      id: uuidv7(),
      workspaceId,
      name,
      normalizedName,
      colorToken: request.colorToken
        ? toTagColorToken(request.colorToken)
        : DEFAULT_TAG_COLOR,
      description: normalizeDescription(request.description),
      createdAt: now,
      updatedAt: now,
    };

    await tx.tags.insert(tag);
    await recordEvent(tx, context, this.clock, {
      workspaceId,
      aggregateType: "tag",
      aggregateId: tag.id,
      eventType: TAG_EVENTS.created,
      summary: `Created tag ${tag.name}`,
      payload: { tagId: tag.id, tagName: tag.name, colorToken: tag.colorToken },
    });
    return tag;
  }

  async update(
    context: ActorContext,
    workspaceId: string,
    tagId: string,
    request: UpdateTagRequest,
  ): Promise<TagDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tagsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const previous = await this.requireTag(tx, workspaceId, tagId);

      const name =
        request.name === undefined ? previous.name : normalizeTagName(request.name);
      const normalizedName = tagLookupKey(name);
      if (normalizedName !== previous.normalizedName) {
        await this.assertNameFree(tx, workspaceId, normalizedName, previous.id);
      }

      const next: Tag = {
        ...previous,
        name,
        normalizedName,
        colorToken:
          request.colorToken === undefined
            ? previous.colorToken
            : toTagColorToken(request.colorToken),
        description:
          request.description === undefined
            ? previous.description
            : normalizeDescription(request.description),
      };

      const changes = tagChanges(next, previous);
      if (Object.keys(changes).length === 0) return toTagDto(previous);

      const updated: Tag = { ...next, updatedAt: this.clock.now() };
      await tx.tags.update(updated);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "tag",
        aggregateId: tagId,
        eventType: TAG_EVENTS.updated,
        summary: `Updated tag ${updated.name}`,
        payload: { tagId, tagName: updated.name, changes },
      });
      return toTagDto(updated);
    });
  }

  async delete(
    context: ActorContext,
    workspaceId: string,
    tagId: string,
  ): Promise<void> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tagsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const tag = await this.requireTag(tx, workspaceId, tagId);
      const taskCount = (await tx.tags.taskCounts(workspaceId)).get(tagId) ?? 0;

      // Associations go with the tag in this same transaction; the tasks stay.
      await tx.tags.delete(workspaceId, tagId);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "tag",
        aggregateId: tagId,
        eventType: TAG_EVENTS.deleted,
        summary: `Deleted tag ${tag.name}`,
        payload: { tagId, tagName: tag.name, taskCount },
      });
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

  private async requireTag(
    tx: TransactionContext,
    workspaceId: string,
    tagId: string,
  ): Promise<Tag> {
    const tag = await tx.tags.findById(workspaceId, tagId);
    if (!tag) throw new DomainError("TAG_NOT_FOUND", "Tag not found.", { tagId });
    return tag;
  }

  /** Case-insensitive uniqueness within the workspace (spec 12.1). */
  private async assertNameFree(
    tx: TransactionContext,
    workspaceId: string,
    normalizedName: string,
    exceptTagId: string | null,
  ): Promise<void> {
    const existing = await tx.tags.findByNormalizedName(workspaceId, normalizedName);
    if (existing && existing.id !== exceptTagId) {
      throw new DomainError(
        "TAG_NAME_CONFLICT",
        `A tag named "${existing.name}" already exists; tag names are case-insensitive.`,
        { field: "name", tagId: existing.id, name: existing.name },
      );
    }
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function tagChanges(
  next: Tag,
  previous: Tag,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["name", "colorToken", "description"] as const) {
    if (next[field] !== previous[field]) {
      changes[field] = { from: previous[field], to: next[field] };
    }
  }
  return changes;
}
