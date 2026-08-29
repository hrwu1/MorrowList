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
  { name: "In Progress", category: "in_progress", colorToken: "amber", isDefault: false },
  { name: "Blocked", category: "blocked", colorToken: "red", isDefault: false },
  { name: "In Review", category: "review", colorToken: "violet", isDefault: false },
  { name: "Done", category: "done", colorToken: "green", isDefault: false },
];
