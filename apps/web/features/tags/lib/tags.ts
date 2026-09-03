import type { TagDto } from "@morrowlist/contracts";

/** Chips a card shows before folding the rest into a "+n" count (spec 9.5). */
export const CARD_TAG_LIMIT = 3;

/** The server's order: case-insensitive by name, then id, so an optimistic patch matches. */
export function sortTags(tags: readonly TagDto[]): TagDto[] {
  return [...tags].sort((left, right) => {
    const a = left.name.toLocaleLowerCase("en-US");
    const b = right.name.toLocaleLowerCase("en-US");
    if (a !== b) return a < b ? -1 : 1;
    return left.id < right.id ? -1 : 1;
  });
}

/** Split a task's tags into the chips to show and the ones behind the overflow count. */
export function visibleTags(
  tags: readonly TagDto[],
  limit: number = CARD_TAG_LIMIT,
): { shown: readonly TagDto[]; hidden: readonly TagDto[] } {
  if (tags.length <= limit) return { shown: tags, hidden: [] };
  return { shown: tags.slice(0, limit), hidden: tags.slice(limit) };
}

/** Case-insensitive lookup by name, matching the server's uniqueness rule (spec 12.1). */
export function findTagByName(
  tags: readonly TagDto[],
  name: string,
): TagDto | undefined {
  const key = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return tags.find((tag) => tag.name.toLocaleLowerCase("en-US") === key);
}
