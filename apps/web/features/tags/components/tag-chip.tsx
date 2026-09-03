import type { TagDto } from "@morrowlist/contracts";

import { CARD_TAG_LIMIT, visibleTags } from "../lib/tags";

/**
 * A tag as a coloured chip. The name is always shown, so colour is never the only
 * signal (spec 14); the colour token maps to a `--tag-*` pair in the UI tokens.
 */
export function TagChip({
  tag,
  onRemove,
}: {
  readonly tag: TagDto;
  readonly onRemove?: (() => void) | undefined;
}) {
  return (
    <span
      className="tag-chip"
      data-color={tag.colorToken}
      title={tag.description ?? undefined}
    >
      <span className="tag-chip__name">{tag.name}</span>
      {onRemove ? (
        <button
          type="button"
          className="tag-chip__remove"
          aria-label={`Remove tag ${tag.name}`}
          onClick={onRemove}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </span>
  );
}

/** Up to `limit` chips plus an overflow count that names the rest for assistive tech. */
export function TagChips({
  tags,
  limit = CARD_TAG_LIMIT,
}: {
  readonly tags: readonly TagDto[];
  readonly limit?: number | undefined;
}) {
  if (tags.length === 0) return null;
  const { shown, hidden } = visibleTags(tags, limit);
  const hiddenNames = hidden.map((tag) => tag.name).join(", ");

  return (
    <ul className="tag-chips" aria-label="Tags">
      {shown.map((tag) => (
        <li key={tag.id}>
          <TagChip tag={tag} />
        </li>
      ))}
      {hidden.length > 0 ? (
        <li>
          <span className="tag-chip tag-chip--more" title={hiddenNames}>
            <span aria-hidden="true">+{hidden.length}</span>
            <span className="ml-visually-hidden">
              {hidden.length} more: {hiddenNames}
            </span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}
