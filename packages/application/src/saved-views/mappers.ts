import type { SavedViewDto } from "@morrowlist/contracts";

import type { SavedView } from "../ports/index.js";

export function toSavedViewDto(view: SavedView): SavedViewDto {
  return {
    id: view.id,
    workspaceId: view.workspaceId,
    ownerUserId: view.ownerUserId,
    name: view.name,
    filters: view.filters,
    layout: view.layout,
    rank: view.rank,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}
