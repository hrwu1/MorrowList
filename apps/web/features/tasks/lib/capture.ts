import type { CreateTaskRequest, RecurrenceRuleDto } from "@morrowlist/contracts";
import { parseCapture, type CaptureResult, type PlainDate } from "@morrowlist/domain";

/**
 * Quick add's half of natural-language capture (GAP-15, ADR
 * pending-natural-language-capture). The reading is done by `parseCapture` in the domain,
 * the same function `morrow task add` calls, so a phrase means one thing in both; this
 * module only turns a parse into the request quick add sends and into the chips it draws.
 *
 * The server never parses. It is sent ordinary fields, exactly as if they had been picked
 * from the collapsed detail controls.
 */

/** A project as capture needs it: a name to match and an id to send. */
export interface NamedProject {
  readonly id: string;
  readonly name: string;
}

/** A tag as capture needs it: a name to match and an id to attach afterwards. */
export interface NamedTag {
  readonly id: string;
  readonly name: string;
}

export interface CaptureDestination {
  /** The pane's project, if quick add is bound to one (a board column). */
  readonly projectId?: string | undefined;
  /** The pane's column; only sent when the task is still going to that project. */
  readonly statusId?: string | undefined;
}

export interface CapturePlan {
  readonly request: CreateTaskRequest;
  /** Applied after the task exists, the way the tag picker does it. */
  readonly tagIds: readonly string[];
}

export function parseQuickAdd(
  text: string,
  today: string,
  projects: readonly NamedProject[],
  tags: readonly NamedTag[],
): CaptureResult {
  return parseCapture(text, {
    today: today as PlainDate,
    projects: projects.map((project) => project.name),
    tags: tags.map((tag) => tag.name),
  });
}

/** The create-task fields a parse stands for; the title is carried separately. */
export function captureFields(result: CaptureResult): Partial<CreateTaskRequest> {
  return {
    ...(result.priority === null ? {} : { priority: result.priority }),
    ...(result.dueDate === null ? {} : { dueDate: result.dueDate }),
    ...(result.dueTime === null ? {} : { dueTime: result.dueTime }),
    ...(result.deferUntil === null ? {} : { deferUntil: result.deferUntil }),
    ...(result.deadline === null ? {} : { deadline: result.deadline }),
    ...(result.deadlineTime === null ? {} : { deadlineTime: result.deadlineTime }),
    ...(result.recurrence === null
      ? {}
      : { recurrence: toRecurrenceDto(result.recurrence) }),
  };
}

function toRecurrenceDto(
  rule: NonNullable<CaptureResult["recurrence"]>,
): RecurrenceRuleDto {
  return { ...rule, weekdays: rule.weekdays ? [...rule.weekdays] : null };
}

/**
 * The request and the tags a parse turns into. A typed `#project` is an explicit
 * instruction, so it overrides the pane's own project; the pane's column goes with it
 * only while the task is still headed for that project, because a status belongs to one.
 */
export function capturePlan(
  result: CaptureResult,
  projects: readonly NamedProject[],
  tags: readonly NamedTag[],
  destination: CaptureDestination,
): CapturePlan {
  const named = projects.find((project) => project.name === result.projectName);
  const projectId = named?.id ?? destination.projectId;
  const keepsStatus = projectId === destination.projectId;

  return {
    request: {
      title: result.title,
      ...captureFields(result),
      ...(projectId ? { projectId } : {}),
      ...(keepsStatus && destination.statusId
        ? { statusId: destination.statusId }
        : {}),
    },
    tagIds: result.tagNames
      .map((name) => tags.find((tag) => tag.name === name)?.id)
      .filter((id): id is string => id !== undefined),
  };
}

/** The one-line summary under the field, e.g. "Call Sam · Planned 2026-09-06 · Urgent". */
export function capturePreview(result: CaptureResult): string {
  const parts = result.spans.filter((span) => span.known).map((span) => span.label);
  return [result.title, ...parts].join(" · ");
}

/* ------------------------------------------------------------- preference */

/**
 * Parsing is a per-device preference (spec 13): it changes how this browser reads what
 * you type, not what the workspace holds, so it needs no column and no request. Reads
 * fall back to on, which is what a first visit should get.
 */
const PARSING_KEY = "morrowlist.capture.parsing";
const PARSING_EVENT = "morrowlist:capture-parsing";

export function readParsingPreference(): boolean {
  try {
    return window.localStorage.getItem(PARSING_KEY) !== "off";
  } catch {
    // Storage is unavailable (private mode); parsing is on, and the chips still show it.
    return true;
  }
}

export function writeParsingPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(PARSING_KEY, enabled ? "on" : "off");
  } catch {
    // Nothing to persist to; the change still applies to this page through the event.
  }
  window.dispatchEvent(new Event(PARSING_EVENT));
}

/** Both the toggle and every open quick add listen, so the switch takes effect at once. */
export function subscribeToParsingPreference(onChange: () => void): () => void {
  window.addEventListener(PARSING_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PARSING_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
