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

/** A page shares tag entities across cards; format each tag once per response. */
export function createTagDtoMapper(): (tag: Tag) => TagDto {
  const cache = new Map<string, TagDto>();
  return (tag) => {
    let dto = cache.get(tag.id);
    if (!dto) {
      dto = toTagDto(tag);
      cache.set(tag.id, dto);
    }
    return dto;
  };
}
