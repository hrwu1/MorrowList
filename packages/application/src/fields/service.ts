import type {
  CreateFieldRequest,
  FieldDefinitionDto,
  FieldFilterDto,
  FieldListResponse,
  UpdateFieldRequest,
} from "@morrowlist/contracts";
import { FIELD_EVENTS } from "@morrowlist/contracts";
import {
  DomainError,
  INITIAL_RANK,
  MAX_FIELDS_PER_WORKSPACE,
  normalizeFieldKey,
  normalizeFieldName,
  normalizeFieldOptions,
  rankBetween,
  resolveFieldFilter,
  systemClock,
  uuidv7,
  type Clock,
  type FieldDefinition,
  type FieldFilter,
} from "@morrowlist/domain";

import type { TransactionContext, UnitOfWork } from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

import { toFieldDefinitionDto } from "./mappers.js";

export interface FieldServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Typed custom-field use cases (GAP-24).
 *
 * The cap of ten is the product decision this service exists to hold: it is counted
 * inside the transaction that would create the eleventh, so two concurrent creates cannot
 * slip past it together. Deleting a definition clears its key from every task in the same
 * transaction and records how many tasks lost a value, because a value with no definition
 * would be invisible data.
 */
export class FieldService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: FieldServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async list(context: ActorContext, workspaceId: string): Promise<FieldListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.fieldsRead);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const [definitions, counts] = await Promise.all([
        tx.fields.listByWorkspace(workspaceId),
        tx.fields.valueCounts(workspaceId),
      ]);
      return {
        data: definitions.map((definition) => ({
          ...toFieldDefinitionDto(definition),
          taskCount: counts.get(definition.key) ?? 0,
        })),
      };
    });
  }

  async create(
    context: ActorContext,
    workspaceId: string,
    request: CreateFieldRequest,
  ): Promise<FieldDefinitionDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.fieldsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const existing = await tx.fields.listByWorkspace(workspaceId);
      if (existing.length >= MAX_FIELDS_PER_WORKSPACE) {
        throw new DomainError(
          "FIELD_LIMIT_REACHED",
          `A workspace can have at most ${MAX_FIELDS_PER_WORKSPACE} custom fields. Delete one before adding another.`,
          { limit: MAX_FIELDS_PER_WORKSPACE, count: existing.length },
        );
      }

      const name = normalizeFieldName(request.name);
      const key = normalizeFieldKey(request.key ?? name);
      if (existing.some((definition) => definition.key === key)) {
        throw new DomainError(
          "FIELD_KEY_CONFLICT",
          `A field with the key "${key}" already exists.`,
          { field: "key", key },
        );
      }

      const now = this.clock.now();
      const definition: FieldDefinition = {
        id: uuidv7(),
        workspaceId,
        key,
        name,
        type: request.type,
        options: normalizeFieldOptions(request.type, request.options),
        rank: rankBetween(existing.at(-1)?.rank ?? null, null) || INITIAL_RANK,
        showOnCard: request.showOnCard ?? false,
        createdAt: now,
        updatedAt: now,
      };

      await tx.fields.insert(definition);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "field",
        aggregateId: definition.id,
        eventType: FIELD_EVENTS.created,
        summary: `Created field ${definition.name}`,
        payload: {
          fieldId: definition.id,
          key: definition.key,
          name: definition.name,
          type: definition.type,
        },
      });
      return toFieldDefinitionDto(definition);
    });
  }

  /** Rename, recut the options, or change what shows on a card. Key and type are fixed. */
  async update(
    context: ActorContext,
    workspaceId: string,
    fieldId: string,
    request: UpdateFieldRequest,
  ): Promise<FieldDefinitionDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.fieldsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const previous = await this.requireField(tx, workspaceId, fieldId);

      const next: FieldDefinition = {
        ...previous,
        name:
          request.name === undefined ? previous.name : normalizeFieldName(request.name),
        options:
          request.options === undefined
            ? previous.options
            : normalizeFieldOptions(previous.type, request.options),
        showOnCard: request.showOnCard ?? previous.showOnCard,
      };

      const changes = definitionChanges(next, previous);
      if (Object.keys(changes).length === 0) return toFieldDefinitionDto(previous);

      const updated: FieldDefinition = { ...next, updatedAt: this.clock.now() };
      await tx.fields.update(updated);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "field",
        aggregateId: fieldId,
        eventType: FIELD_EVENTS.updated,
        summary: `Updated field ${updated.name}`,
        payload: {
          fieldId,
          key: updated.key,
          name: updated.name,
          type: updated.type,
          changes,
        },
      });
      return toFieldDefinitionDto(updated);
    });
  }

  /**
   * Delete a definition and, in the same transaction, the key it left on every task. The
   * event carries the affected count so the history says what the deletion cost.
   */
  async delete(
    context: ActorContext,
    workspaceId: string,
    fieldId: string,
  ): Promise<void> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.fieldsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const definition = await this.requireField(tx, workspaceId, fieldId);

      const taskCount = await tx.fields.clearValues(workspaceId, definition.key);
      await tx.fields.delete(workspaceId, fieldId);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "field",
        aggregateId: fieldId,
        eventType: FIELD_EVENTS.deleted,
        summary: `Deleted field ${definition.name}`,
        payload: {
          fieldId,
          key: definition.key,
          name: definition.name,
          type: definition.type,
          taskCount,
        },
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

  private async requireField(
    tx: TransactionContext,
    workspaceId: string,
    fieldId: string,
  ): Promise<FieldDefinition> {
    const definition = await tx.fields.findById(workspaceId, fieldId);
    if (!definition) {
      throw new DomainError("FIELD_NOT_FOUND", "Field not found.", { fieldId });
    }
    return definition;
  }
}

/**
 * Bind the field filters of a query to the workspace's definitions: unknown keys are
 * refused rather than silently ignored, so a typo never turns into a full list, and the
 * values are coerced to their stored form for the repository to compare (GAP-24).
 */
export async function resolveFieldFilters(
  tx: TransactionContext,
  workspaceId: string,
  filters: readonly FieldFilterDto[] | undefined,
): Promise<readonly FieldFilter[] | undefined> {
  if (!filters || filters.length === 0) return undefined;
  const definitions = await tx.fields.listByWorkspace(workspaceId);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  return filters.map((filter) => {
    const definition = byKey.get(filter.key);
    if (!definition) {
      throw new DomainError(
        "FIELD_NOT_FOUND",
        `No field named "${filter.key}" in this workspace.`,
        { field: "fields", key: filter.key },
      );
    }
    return resolveFieldFilter(filter, definition);
  });
}

function definitionChanges(
  next: FieldDefinition,
  previous: FieldDefinition,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (next.name !== previous.name) {
    changes.name = { from: previous.name, to: next.name };
  }
  if (next.showOnCard !== previous.showOnCard) {
    changes.showOnCard = { from: previous.showOnCard, to: next.showOnCard };
  }
  if (next.options.join("\u0000") !== previous.options.join("\u0000")) {
    changes.options = { from: [...previous.options], to: [...next.options] };
  }
  return changes;
}
