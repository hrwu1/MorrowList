import { ApiError } from "../errors.js";

/** Resolve the implied personal workspace without hardcoding a single-workspace model. */
export function requireWorkspace(
  requested: string | undefined,
  available: readonly string[],
): string {
  if (requested) return requested;
  const only = available[0];
  if (available.length === 1 && only) return only;
  throw new ApiError(
    "VALIDATION_FAILED",
    "workspaceId is required when the caller can reach more than one workspace.",
    { field: "workspaceId" },
  );
}
