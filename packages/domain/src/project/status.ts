import { DomainError, ValidationError } from "../shared/errors.js";
import { rankBetween } from "../shared/rank.js";

/**
 * Workflow status semantics (spec 11.3). Category drives completion and reporting: a task
 * entering a `done` status is completed, and leaving one reopens it.
 */
export const STATUS_CATEGORIES = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
] as const;

export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export function isStatusCategory(value: string): value is StatusCategory {
  return (STATUS_CATEGORIES as readonly string[]).includes(value);
}

/** `is_terminal` is derived from the category rather than stored independently (spec 11.3). */
export function isTerminalCategory(category: StatusCategory): boolean {
  return category === "done";
}

export interface WorkflowStatus {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly rank: string;
  readonly colorToken: string;
  readonly wipLimit: number | null;
  readonly isDefault: boolean;
  /** Optional column policy shown to the user, in Markdown (spec 11.3, GAP-20). */
  readonly policyMd: string | null;
  readonly archivedAt: Date | null;
  readonly version: number;
}

export function isTerminal(status: WorkflowStatus): boolean {
  return isTerminalCategory(status.category);
}

export function isActive(status: WorkflowStatus): boolean {
  return status.archivedAt === null;
}

/**
 * The six default statuses created atomically with every new project (spec 11.2).
 * `Ready` is the default for new tasks and `Done` is the single terminal status.
 */
export const DEFAULT_WORKFLOW: readonly {
  name: string;
  category: StatusCategory;
  colorToken: string;
  isDefault: boolean;
}[] = [
  { name: "Backlog", category: "backlog", colorToken: "slate", isDefault: false },
  { name: "Ready", category: "ready", colorToken: "blue", isDefault: true },
  {
    name: "In Progress",
    category: "in_progress",
    colorToken: "amber",
    isDefault: false,
  },
  { name: "Blocked", category: "blocked", colorToken: "red", isDefault: false },
  { name: "In Review", category: "review", colorToken: "violet", isDefault: false },
  { name: "Done", category: "done", colorToken: "green", isDefault: false },
];

export const STATUS_NAME_MAX_LENGTH = 80;

export function normalizeStatusName(raw: string): string {
  const name = raw.normalize("NFC").trim();
  if (name.length === 0) {
    throw new ValidationError("Status name is required.", { field: "name" });
  }
  if ([...name].length > STATUS_NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Status name must be ${STATUS_NAME_MAX_LENGTH} characters or fewer.`,
      { field: "name", maxLength: STATUS_NAME_MAX_LENGTH },
    );
  }
  return name;
}

function normalizeWipLimit(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError("A WIP limit must be a positive whole number.", {
      field: "wipLimit",
    });
  }
  return value;
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Workflow constraints (spec 11.4) over a project's active statuses. Every policy below
 * evaluates the workflow that would result and rejects the change that would break it,
 * so no code path can persist a project with no valid default or no Done column.
 */
export function assertWorkflowInvariants(active: readonly WorkflowStatus[]): void {
  const defaults = active.filter((status) => status.isDefault);
  if (defaults.length !== 1) {
    throw new DomainError(
      "WORKFLOW_INVARIANT_VIOLATED",
      "Exactly one active status must be the default for new tasks.",
      { invariant: "one_default", defaultCount: defaults.length },
    );
  }
  const [defaultStatus] = defaults;
  if (defaultStatus && isTerminal(defaultStatus)) {
    throw new DomainError(
      "WORKFLOW_INVARIANT_VIOLATED",
      "The default status for new tasks cannot be a Done status.",
      { invariant: "default_not_terminal", statusId: defaultStatus.id },
    );
  }
  if (!active.some(isTerminal)) {
    throw new DomainError(
      "WORKFLOW_INVARIANT_VIOLATED",
      "At least one active status must be a Done status.",
      { invariant: "terminal_required" },
    );
  }
  if (active.every(isTerminal)) {
    throw new DomainError(
      "WORKFLOW_INVARIANT_VIOLATED",
      "At least one active status must not be a Done status.",
      { invariant: "nonterminal_required" },
    );
  }
}

function requireActiveStatus(
  statuses: readonly WorkflowStatus[],
  statusId: string,
): WorkflowStatus {
  const status = statuses.find((candidate) => candidate.id === statusId);
  if (!status || !isActive(status)) {
    throw new DomainError("STATUS_NOT_FOUND", "Status not found.", { statusId });
  }
  return status;
}

/** Bump the version only when something material changed. */
function touchStatus(next: WorkflowStatus, previous: WorkflowStatus): WorkflowStatus {
  const changed = (Object.keys(next) as (keyof WorkflowStatus)[]).some((field) => {
    const a = next[field];
    const b = previous[field];
    if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
    return a !== b;
  });
  return changed ? { ...next, version: previous.version + 1 } : previous;
}

export interface CreateStatusInput {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly colorToken?: string | undefined;
  readonly wipLimit?: number | null | undefined;
  readonly policyMd?: string | null | undefined;
}

/**
 * Add a column at the end of the workflow. `statuses` is the project's full list, archived
 * included, because archived rows still occupy rank space. A new column is never the
 * default; `updateStatus` promotes it explicitly.
 */
export function createStatus(
  input: CreateStatusInput,
  statuses: readonly WorkflowStatus[],
): WorkflowStatus {
  const lastRank = statuses
    .filter((status) => status.projectId === input.projectId)
    .map((status) => status.rank)
    .sort()
    .at(-1);

  return {
    id: input.id,
    projectId: input.projectId,
    name: normalizeStatusName(input.name),
    category: input.category,
    rank: rankBetween(lastRank ?? null, null),
    colorToken: input.colorToken?.trim() || "slate",
    wipLimit: normalizeWipLimit(input.wipLimit ?? null),
    isDefault: false,
    policyMd: normalizeOptionalText(input.policyMd ?? null),
    archivedAt: null,
    version: 1,
  };
}

export interface UpdateStatusInput {
  readonly name?: string | undefined;
  readonly category?: StatusCategory | undefined;
  readonly colorToken?: string | undefined;
  readonly wipLimit?: number | null | undefined;
  readonly isDefault?: boolean | undefined;
  readonly policyMd?: string | null | undefined;
}

/**
 * Edit a column. Renaming never touches the category, so it never changes completion
 * semantics (spec 9.5); a category change is validated against the whole workflow.
 * Promoting a column to default demotes the previous default in the same change.
 *
 * Returns every status that changed, edited one first, so the caller persists them
 * together.
 */
export function updateStatus(
  statuses: readonly WorkflowStatus[],
  statusId: string,
  input: UpdateStatusInput,
): WorkflowStatus[] {
  const active = statuses.filter(isActive);
  const previous = requireActiveStatus(active, statusId);

  if (input.isDefault === false && previous.isDefault) {
    throw new DomainError(
      "WORKFLOW_INVARIANT_VIOLATED",
      "Choose another default status instead of removing this one.",
      { invariant: "one_default", statusId },
    );
  }

  const next = touchStatus(
    {
      ...previous,
      name: input.name === undefined ? previous.name : normalizeStatusName(input.name),
      category: input.category ?? previous.category,
      colorToken:
        input.colorToken === undefined
          ? previous.colorToken
          : input.colorToken.trim() || previous.colorToken,
      wipLimit:
        input.wipLimit === undefined
          ? previous.wipLimit
          : normalizeWipLimit(input.wipLimit),
      isDefault: input.isDefault ?? previous.isDefault,
      policyMd:
        input.policyMd === undefined
          ? previous.policyMd
          : normalizeOptionalText(input.policyMd),
    },
    previous,
  );

  const changed: WorkflowStatus[] = next === previous ? [] : [next];
  const resulting = active.map((status) => {
    if (status.id === statusId) return next;
    if (next.isDefault && status.isDefault) {
      const demoted = touchStatus({ ...status, isDefault: false }, status);
      changed.push(demoted);
      return demoted;
    }
    return status;
  });

  assertWorkflowInvariants(resulting);
  return changed;
}

export interface ReorderStatusInput {
  /** Lower-rank predecessor and higher-rank successor; both null appends at the end. */
  readonly beforeStatusId?: string | null | undefined;
  readonly afterStatusId?: string | null | undefined;
}

/** Move a column between two neighbours; the server owns the rank (spec 24.1). */
export function reorderStatus(
  statuses: readonly WorkflowStatus[],
  statusId: string,
  input: ReorderStatusInput,
): WorkflowStatus {
  const active = statuses.filter(isActive);
  const status = requireActiveStatus(active, statusId);
  const beforeId = input.beforeStatusId ?? null;
  const afterId = input.afterStatusId ?? null;

  if (beforeId === statusId || afterId === statusId) {
    throw new ValidationError("A status cannot be its own ordering neighbour.", {
      statusId,
    });
  }
  if (beforeId !== null && beforeId === afterId) {
    throw new ValidationError("Ordering neighbours must be different statuses.", {
      beforeStatusId: beforeId,
      afterStatusId: afterId,
    });
  }

  const before = beforeId ? requireActiveStatus(active, beforeId) : null;
  const after = afterId ? requireActiveStatus(active, afterId) : null;
  if (before && after && before.rank >= after.rank) {
    throw new ValidationError("Ordering neighbours are not in workflow order.", {
      beforeStatusId: beforeId,
      afterStatusId: afterId,
    });
  }

  const rank =
    before === null && after === null
      ? rankBetween(
          active
            .filter((candidate) => candidate.id !== statusId)
            .map((candidate) => candidate.rank)
            .sort()
            .at(-1) ?? null,
          null,
        )
      : rankBetween(before?.rank ?? null, after?.rank ?? null);

  return touchStatus({ ...status, rank }, status);
}

export interface ArchiveStatusInput {
  /** Whether the column still holds tasks (trashed ones included). */
  readonly hasTasks: boolean;
  /** Where the column's tasks go. Required when `hasTasks` (spec 11.4). */
  readonly destinationStatusId?: string | null | undefined;
  /** The new default when the default column is archived; falls back to the destination. */
  readonly newDefaultStatusId?: string | null | undefined;
}

export interface ArchiveStatusResult {
  readonly archived: WorkflowStatus;
  readonly destination: WorkflowStatus | null;
  readonly newDefault: WorkflowStatus | null;
}

/**
 * Archive a column (spec 8.6, 11.4). The caller moves the tasks to `destination` and
 * persists `newDefault` in the same transaction as `archived`, so the workflow is never
 * observed without a default or with orphaned tasks.
 */
export function archiveStatus(
  statuses: readonly WorkflowStatus[],
  statusId: string,
  input: ArchiveStatusInput,
  now: Date,
): ArchiveStatusResult {
  const active = statuses.filter(isActive);
  const status = requireActiveStatus(active, statusId);
  const destinationId = input.destinationStatusId ?? null;

  if (destinationId === statusId) {
    throw new ValidationError("A status cannot be its own archive destination.", {
      statusId,
    });
  }
  const destination = destinationId ? requireActiveStatus(active, destinationId) : null;
  if (input.hasTasks && destination === null) {
    throw new DomainError(
      "STATUS_ARCHIVE_REQUIRES_DESTINATION",
      "This status still has tasks. Choose where they should go first.",
      { statusId },
    );
  }

  let newDefault: WorkflowStatus | null = null;
  if (status.isDefault) {
    const replacementId = input.newDefaultStatusId ?? destinationId;
    const replacement = replacementId
      ? active.find((candidate) => candidate.id === replacementId)
      : undefined;
    if (!replacement || replacement.id === statusId || isTerminal(replacement)) {
      throw new DomainError(
        "STATUS_ARCHIVE_REQUIRES_REPLACEMENT",
        "This is the default status for new tasks. Choose a replacement first.",
        { statusId, replacementStatusId: replacementId },
      );
    }
    newDefault = touchStatus({ ...replacement, isDefault: true }, replacement);
  }

  const archived: WorkflowStatus = {
    ...status,
    isDefault: false,
    archivedAt: now,
    version: status.version + 1,
  };

  assertWorkflowInvariants(
    active
      .filter((candidate) => candidate.id !== statusId)
      .map((candidate) => (candidate.id === newDefault?.id ? newDefault : candidate)),
  );

  return {
    archived,
    destination:
      destination && destination.id === newDefault?.id ? newDefault : destination,
    newDefault,
  };
}
