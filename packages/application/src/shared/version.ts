import { DomainError } from "@morrowlist/domain";

/** Optimistic concurrency for projects and statuses (spec 24.2). */
export function assertVersion(
  entity: { readonly id: string; readonly version: number },
  expectedVersion: number | undefined,
  what: "project" | "status" | "workspace",
): void {
  if (expectedVersion === undefined || expectedVersion === entity.version) return;
  throw new DomainError(
    "VERSION_CONFLICT",
    `The ${what} changed after you loaded it.`,
    {
      [`${what}Id`]: entity.id,
      expectedVersion,
      actualVersion: entity.version,
    },
  );
}

export function versionConflict(
  entity: { readonly id: string; readonly version: number },
  what: "project" | "status" | "workspace",
): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    `The ${what} changed after you loaded it.`,
    { [`${what}Id`]: entity.id, expectedVersion: entity.version },
  );
}
