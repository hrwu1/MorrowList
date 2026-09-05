/**
 * Scopes and the presets a credential can be created with (spec 22.3, 22.4).
 *
 * They live in `contracts` rather than in the application layer because they are part of
 * the public contract: the CLI prints them, the docs list them, and the API enforces
 * them. One definition, three readers.
 */

export const SCOPES = {
  tasksRead: "tasks:read",
  tasksWrite: "tasks:write",
  projectsRead: "projects:read",
  projectsWrite: "projects:write",
  activityRead: "activity:read",
  tagsRead: "tags:read",
  tagsWrite: "tags:write",
  workspaceWrite: "workspace:write",
  viewsRead: "views:read",
  viewsWrite: "views:write",
  /** Reading the whole workspace out (GAP-07); wider than any single read scope. */
  exportRead: "export:read",
  /** Writing a whole project in from another tool (GAP-07). */
  importWrite: "import:write",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/**
 * A preset is a starting point, not a role: a key stores the scopes it was granted, so
 * changing a preset later never widens a key that already exists.
 *
 * `agent` is the interesting one. An AI assistant needs to read and reshape work, so it
 * gets the task and tag verbs — but not `workspace:write`, which would let it manage
 * webhook endpoints, and not `projects:write`, which would let it archive a project.
 * Destroying structure stays a human act (ADR-006).
 */
export const SCOPE_PRESETS = {
  /** Everything the CLI needs to be a peer of the web app (spec 22.4). */
  cli: [
    SCOPES.tasksRead,
    SCOPES.tasksWrite,
    SCOPES.projectsRead,
    SCOPES.projectsWrite,
    SCOPES.tagsRead,
    SCOPES.tagsWrite,
    SCOPES.activityRead,
    SCOPES.viewsRead,
    SCOPES.viewsWrite,
    SCOPES.exportRead,
    SCOPES.importWrite,
  ],
  /**
   * An assistant or automation: reshape work, but do not reshape the workspace.
   *
   * `export:read` is granted — it reads nothing the paged read scopes above do not
   * already reach, it just does it in one call. `import:write` is withheld for the same
   * reason as the two write scopes: it creates a project, and destroying or inventing
   * structure stays a human act (ADR-006, GAP-07).
   */
  agent: [
    SCOPES.tasksRead,
    SCOPES.tasksWrite,
    SCOPES.projectsRead,
    SCOPES.tagsRead,
    SCOPES.tagsWrite,
    SCOPES.activityRead,
    SCOPES.viewsRead,
    SCOPES.exportRead,
  ],
  /** A dashboard, an export job, a status page. */
  readonly: [
    SCOPES.tasksRead,
    SCOPES.projectsRead,
    SCOPES.tagsRead,
    SCOPES.activityRead,
    SCOPES.viewsRead,
    SCOPES.exportRead,
  ],
} as const satisfies Record<string, readonly Scope[]>;

export type ScopePreset = keyof typeof SCOPE_PRESETS;
