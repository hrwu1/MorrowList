import { DomainError, systemClock, type Clock, type Task } from "@morrowlist/domain";

import { renderTaskEvents, wrapCalendar, type EventResource } from "../calendar/ics.js";
import type {
  CalDavObject,
  TransactionContext,
  UnitOfWork,
  Workspace,
} from "../ports/index.js";
import { assertWorkspaceAccess, type ActorContext } from "../shared/actor-context.js";
import type { TaskService } from "../tasks/service.js";

import { parseEvent, propertyLines } from "./parse.js";
import { decodeSyncToken, encodeSyncToken } from "./sync.js";

export interface CalDavServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly taskService: TaskService;
  readonly appUrl: string;
  readonly clock?: Clock;
}

/** A calendar collection: one per workspace the caller belongs to. */
export interface CalDavCalendar {
  readonly workspaceId: string;
  readonly name: string;
  readonly timezone: string;
  /** Changes with every task change; equals the sync token. */
  readonly ctag: string;
}

/** A calendar object resource as a client addresses it. */
export interface CalDavEntry {
  readonly path: string;
  readonly etag: string;
  readonly taskId: string;
  readonly resource: EventResource;
}

export interface CalDavResourceBody extends CalDavEntry {
  readonly ics: string;
}

export interface CalDavChanges {
  readonly syncToken: string;
  readonly changed: readonly CalDavResourceBody[];
  readonly removed: readonly string[];
  /** More changes exist; the returned token continues from the last one included. */
  readonly truncated: boolean;
}

export interface CalDavWriteOptions {
  /** The version the client last saw (`If-Match`); a mismatch is a conflict. */
  readonly expectedVersion?: number;
  /** `If-None-Match: *`: the resource must not exist yet. */
  readonly mustNotExist?: boolean;
}

export interface CalDavWriteResult {
  readonly path: string;
  readonly etag: string;
  readonly created: boolean;
}

const RESOURCE_LIMIT = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const etagOf = (task: Task) => `"${task.version}"`;
const isOpen = (task: Task) => !task.completedAt && !task.deletedAt;
const hasEvents = (task: Task) => task.dueDate !== null || task.deadline !== null;

interface Resolved {
  readonly task: Task;
  readonly resource: EventResource;
  readonly object: CalDavObject | null;
}

/**
 * CalDAV view of a workspace's tasks (GAP-25): each open task with a planned date is a
 * VEVENT resource, each deadline a second labelled one. Writes go through TaskService so
 * a client edit is one audited mutation like any other.
 */
export class CalDavService {
  private readonly clock: Clock;
  constructor(private readonly options: CalDavServiceOptions) {
    this.clock = options.clock ?? systemClock;
  }

  async listCalendars(context: ActorContext): Promise<readonly CalDavCalendar[]> {
    return this.options.unitOfWork.execute(async (tx) => {
      const workspaces = await tx.workspaces.listForUser(context.userId ?? "");
      const calendars: CalDavCalendar[] = [];
      for (const workspace of workspaces) {
        if (!context.workspaceIds.includes(workspace.id)) continue;
        calendars.push(await this.calendarOf(tx, workspace));
      }
      return calendars;
    });
  }

  async calendar(context: ActorContext, workspaceId: string): Promise<CalDavCalendar> {
    assertWorkspaceAccess(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) =>
      this.calendarOf(tx, await this.requireWorkspace(tx, workspaceId)),
    );
  }

  /** Every resource a depth-1 listing or an unfiltered calendar-query shows. */
  async listResources(
    context: ActorContext,
    workspaceId: string,
  ): Promise<readonly CalDavEntry[]> {
    assertWorkspaceAccess(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const page = await tx.tasks.listCalendar({
        workspaceId,
        from: null,
        to: null,
        limit: RESOURCE_LIMIT,
      });
      const paths = await this.pathsByTask(tx, workspaceId);
      return page.items.flatMap((task) => this.entriesOf(task, paths));
    });
  }

  async getResource(
    context: ActorContext,
    workspaceId: string,
    path: string,
  ): Promise<CalDavResourceBody | null> {
    assertWorkspaceAccess(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const resolved = await this.resolve(tx, workspaceId, path);
      if (!resolved || !isOpen(resolved.task)) return null;
      return this.bodyOf(resolved, workspace, path);
    });
  }

  async multiget(
    context: ActorContext,
    workspaceId: string,
    paths: readonly string[],
  ): Promise<readonly (CalDavResourceBody | { path: string; missing: true })[]> {
    assertWorkspaceAccess(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const results: (CalDavResourceBody | { path: string; missing: true })[] = [];
      for (const path of paths) {
        const resolved = await this.resolve(tx, workspaceId, path);
        results.push(
          resolved && isOpen(resolved.task)
            ? this.bodyOf(resolved, workspace, path)
            : { path, missing: true },
        );
      }
      return results;
    });
  }

  /**
   * What changed since a token (RFC 6578). An unknown token returns null so the HTTP
   * layer can answer `valid-sync-token` and the client restarts from nothing.
   */
  async changesSince(
    context: ActorContext,
    workspaceId: string,
    token: string,
  ): Promise<CalDavChanges | null> {
    assertWorkspaceAccess(context, workspaceId);
    const since = token === "" ? { latest: null, count: 0 } : decodeSyncToken(token);
    if (!since) return null;
    return this.options.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const page = await tx.tasks.listChangedSince(
        workspaceId,
        since.latest,
        RESOURCE_LIMIT,
      );
      const paths = await this.pathsByTask(tx, workspaceId);
      const changed: CalDavResourceBody[] = [];
      const removed: string[] = [];
      for (const task of page.items) {
        const path = paths.get(task.id)?.path ?? task.id;
        const object = paths.get(task.id) ?? null;
        if (isOpen(task) && task.dueDate !== null)
          changed.push(
            this.bodyOf({ task, resource: "task", object }, workspace, path),
          );
        else if (since.latest !== null) removed.push(path);
        if (isOpen(task) && task.deadline !== null)
          changed.push(
            this.bodyOf(
              { task, resource: "deadline", object: null },
              workspace,
              `${task.id}-deadline`,
            ),
          );
        else if (since.latest !== null) removed.push(`${task.id}-deadline`);
      }
      const last = page.items.at(-1);
      const syncToken =
        page.truncated && last
          ? encodeSyncToken({ latest: last.updatedAt, count: since.count })
          : encodeSyncToken(await tx.tasks.syncStamp(workspaceId));
      return { syncToken, changed, removed, truncated: page.truncated };
    });
  }

  async put(
    context: ActorContext,
    workspaceId: string,
    path: string,
    body: string,
    options: CalDavWriteOptions = {},
  ): Promise<CalDavWriteResult> {
    assertWorkspaceAccess(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const event = parseEvent(body, workspace.timezone);
      const resolved = await this.resolve(tx, workspaceId, path);
      if (resolved && options.mustNotExist)
        throw new DomainError("VERSION_CONFLICT", "The resource already exists.");
      if (resolved && !isOpen(resolved.task))
        throw new DomainError(
          "AUTH_FORBIDDEN",
          "This event belongs to a completed or deleted task; restore it in MorrowList.",
        );
      const now = this.clock.now();
      if (resolved?.resource === "deadline") {
        await this.options.taskService.update(context, workspaceId, resolved.task.id, {
          deadline: event.dueDate,
          deadlineTime: event.dueTime,
          ...(options.expectedVersion
            ? { expectedVersion: options.expectedVersion }
            : {}),
        });
        const task = await this.requireTask(tx, workspaceId, resolved.task.id);
        return { path, etag: etagOf(task), created: false };
      }
      const fields = {
        title: event.title,
        descriptionMd: event.descriptionMd,
        dueDate: event.dueDate,
        dueTime: event.dueTime,
        dueTimezone: event.dueTime ? event.dueTimezone : null,
        reminderOffsetMinutes: event.reminderOffsetMinutes,
      };
      let taskId: string;
      if (resolved) {
        await this.options.taskService.update(context, workspaceId, resolved.task.id, {
          ...fields,
          ...(options.expectedVersion
            ? { expectedVersion: options.expectedVersion }
            : {}),
        });
        taskId = resolved.task.id;
      } else {
        const existing = await tx.caldavObjects.findByUid(workspaceId, event.uid);
        if (existing)
          throw new DomainError(
            "VERSION_CONFLICT",
            "An event with this UID already exists at another path.",
            { precondition: "no-uid-conflict", path: existing.path },
          );
        const created = await this.options.taskService.create(context, {
          workspaceId,
          ...fields,
        });
        taskId = created.id;
      }
      await tx.caldavObjects.upsert({
        workspaceId,
        taskId,
        resource: "task",
        path,
        uid: event.uid,
        properties: event.properties,
        updatedAt: now,
      });
      const task = await this.requireTask(tx, workspaceId, taskId);
      return { path, etag: etagOf(task), created: !resolved };
    });
  }

  async delete(
    context: ActorContext,
    workspaceId: string,
    path: string,
    options: CalDavWriteOptions = {},
  ): Promise<boolean> {
    assertWorkspaceAccess(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const resolved = await this.resolve(tx, workspaceId, path);
      if (!resolved || !isOpen(resolved.task)) return false;
      if (resolved.resource === "deadline")
        await this.options.taskService.update(context, workspaceId, resolved.task.id, {
          deadline: null,
          deadlineTime: null,
          ...(options.expectedVersion
            ? { expectedVersion: options.expectedVersion }
            : {}),
        });
      else
        await this.options.taskService.delete(
          context,
          workspaceId,
          resolved.task.id,
          options.expectedVersion,
        );
      return true;
    });
  }

  private async calendarOf(
    tx: TransactionContext,
    workspace: Workspace,
  ): Promise<CalDavCalendar> {
    return {
      workspaceId: workspace.id,
      name: workspace.name,
      timezone: workspace.timezone,
      ctag: encodeSyncToken(await tx.tasks.syncStamp(workspace.id)),
    };
  }

  private async pathsByTask(
    tx: TransactionContext,
    workspaceId: string,
  ): Promise<Map<string, CalDavObject>> {
    const objects = await tx.caldavObjects.listByWorkspace(workspaceId);
    return new Map(
      objects.filter((o) => o.resource === "task").map((o) => [o.taskId, o] as const),
    );
  }

  private entriesOf(task: Task, paths: Map<string, CalDavObject>): CalDavEntry[] {
    if (!isOpen(task) || !hasEvents(task)) return [];
    const entries: CalDavEntry[] = [];
    if (task.dueDate !== null)
      entries.push({
        path: paths.get(task.id)?.path ?? task.id,
        etag: etagOf(task),
        taskId: task.id,
        resource: "task",
      });
    if (task.deadline !== null)
      entries.push({
        path: `${task.id}-deadline`,
        etag: etagOf(task),
        taskId: task.id,
        resource: "deadline",
      });
    return entries;
  }

  /** A client path names a stored object, a task id, or a task id's deadline. */
  private async resolve(
    tx: TransactionContext,
    workspaceId: string,
    path: string,
  ): Promise<Resolved | null> {
    const object = await tx.caldavObjects.findByPath(workspaceId, path);
    if (object) {
      const task = await tx.tasks.findById(workspaceId, object.taskId);
      return task ? { task, resource: "task", object } : null;
    }
    const deadline = path.endsWith("-deadline");
    const id = deadline ? path.slice(0, -"-deadline".length) : path;
    if (!UUID.test(id)) return null;
    const task = await tx.tasks.findById(workspaceId, id);
    if (!task) return null;
    if (deadline)
      return task.deadline === null
        ? null
        : { task, resource: "deadline", object: null };
    // A task whose client-named object lives elsewhere is not also served under its id.
    const claimed = await tx.caldavObjects.listByTask(workspaceId, task.id);
    if (claimed.some((o) => o.resource === "task")) return null;
    return task.dueDate === null ? null : { task, resource: "task", object: null };
  }

  private bodyOf(
    resolved: Resolved,
    workspace: Workspace,
    path: string,
  ): CalDavResourceBody {
    const events = renderTaskEvents(resolved.task, workspace, this.options.appUrl, {
      ...(resolved.object ? { uid: resolved.object.uid } : {}),
      extraLines: resolved.object ? propertyLines(resolved.object.properties) : [],
    });
    const event = events.find((e) => e.resource === resolved.resource);
    return {
      path,
      etag: etagOf(resolved.task),
      taskId: resolved.task.id,
      resource: resolved.resource,
      ics: wrapCalendar(event ? [event.lines] : [], null),
    };
  }

  private async requireWorkspace(
    tx: TransactionContext,
    workspaceId: string,
  ): Promise<Workspace> {
    const workspace = await tx.workspaces.findById(workspaceId);
    if (!workspace)
      throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
        workspaceId,
      });
    return workspace;
  }

  private async requireTask(
    tx: TransactionContext,
    workspaceId: string,
    taskId: string,
  ): Promise<Task> {
    const task = await tx.tasks.findById(workspaceId, taskId);
    if (!task) throw new DomainError("TASK_NOT_FOUND", "Task not found.", { taskId });
    return task;
  }
}
