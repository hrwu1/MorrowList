import type { FieldDefinitionDto } from "@morrowlist/contracts";
import type { FieldDefinition } from "@morrowlist/domain";

export function toFieldDefinitionDto(definition: FieldDefinition): FieldDefinitionDto {
  return {
    id: definition.id,
    workspaceId: definition.workspaceId,
    key: definition.key,
    name: definition.name,
    type: definition.type,
    options: [...definition.options],
    rank: definition.rank,
    showOnCard: definition.showOnCard,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}
