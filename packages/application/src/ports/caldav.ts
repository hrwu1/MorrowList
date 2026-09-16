/** Which of a task's CalDAV resources a row describes (GAP-25). */
export type CalDavResource = "task" | "deadline";

/**
 * A CalDAV resource a client has written. Tasks without a row are served under their id
 * with generated properties; a row keeps the client-chosen name, the client UID, and the
 * iCalendar properties MorrowList does not model so they survive a round trip.
 */
export interface CalDavObject {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly resource: CalDavResource;
  /** Resource name without the `.ics` suffix, unique within the workspace. */
  readonly path: string;
  readonly uid: string;
  /** Unmodelled VEVENT properties in jCal form (`[name, params, type, value]`). */
  readonly properties: readonly unknown[];
  readonly updatedAt: Date;
}

export interface CalDavObjectRepository {
  findByPath(workspaceId: string, path: string): Promise<CalDavObject | null>;
  findByUid(workspaceId: string, uid: string): Promise<CalDavObject | null>;
  listByWorkspace(workspaceId: string): Promise<readonly CalDavObject[]>;
  listByTask(workspaceId: string, taskId: string): Promise<readonly CalDavObject[]>;
  upsert(object: CalDavObject): Promise<void>;
  delete(workspaceId: string, taskId: string, resource: CalDavResource): Promise<void>;
}
