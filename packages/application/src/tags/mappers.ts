import type { TagDto } from "@morrowlist/contracts";
import type { Tag } from "@morrowlist/domain";

export function toTagDto(tag: Tag): TagDto {
  return {
    id: tag.id,
    workspaceId: tag.workspaceId,
    name: tag.name,
    colorToken: tag.colorToken,
    description: tag.description,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}
