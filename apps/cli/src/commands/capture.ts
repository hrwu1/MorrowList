import type { ApiClient } from "@morrowlist/api-client";
import type { CreateTaskRequest, RecurrenceRuleDto } from "@morrowlist/contracts";
import {
  parseCapture,
  toLocalDate,
  type CaptureResult,
  type PlainDate,
} from "@morrowlist/domain";

/**
 * `morrow task add "<text>"` reads the text the way quick add does (GAP-15, ADR
 * pending-natural-language-capture): the same `parseCapture` in the domain, so a phrase
 * means one thing in both products. `--literal` turns it off.
 *
 * Relative phrases need a calendar date. A single command carries no workspace context,
 * so the host's local date is used; `--due` and the other flags are exact and always win.
 */

/** A project as capture needs it: a name to match and an id to send. */
export interface NamedProject {
  readonly id: string;
  readonly name: string;
}

/** The workspace names to match against, and what to do with an unknown tag. */
export interface CaptureContext {
  readonly projects: readonly NamedProject[];
  readonly tags: readonly string[];
  /** With `--create-tags`, an unknown `@name` is a tag to create rather than text. */
  readonly createTags: boolean;
  /** Overridden by the tests; the host's calendar date otherwise. */
  readonly today?: string | undefined;
}

/** `#`, `@` or a `tag:` operator: the only reasons to fetch the workspace's names. */
const HAS_MARKER = /(^|\s)([#@]\S|tag:)/i;

export function needsWorkspaceNames(text: string): boolean {
  return HAS_MARKER.test(text);
}

/**
 * Parse `text` against a workspace. With `--create-tags` the unknown tag names are fed
 * back in and the text is read again, so `@newtag` becomes a tag rather than staying in
 * the title; `resolveTags` then creates it.
 */
export function capture(text: string, context: CaptureContext): CaptureResult {
  const today = (context.today ?? toLocalDate(new Date(), hostTimezone())) as PlainDate;
  const projects = context.projects.map((project) => project.name);
  const first = parseCapture(text, { today, projects, tags: context.tags });
  if (!context.createTags || first.unknownTags.length === 0) return first;
  return parseCapture(text, {
    today,
    projects,
    tags: [...context.tags, ...first.unknownTags],
  });
}

function hostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The names capture matches against, fetched only when the text carries a marker. */
export async function captureContext(
  client: ApiClient,
  text: string,
  createTags: boolean,
): Promise<CaptureContext> {
  if (!needsWorkspaceNames(text)) return { projects: [], tags: [], createTags };
  const [projects, tags] = await Promise.all([
    client.listProjects(),
    client.listTags(),
  ]);
  return {
    projects: projects.data.map((project) => ({
      id: project.id,
      name: project.name,
    })),
    tags: tags.data.map((tag) => tag.name),
    createTags,
  };
}

/** The id of the project `parseCapture` resolved; it came from this same list. */
export function projectIdFor(
  context: CaptureContext,
  name: string | null,
): string | null {
  if (name === null) return null;
  return context.projects.find((project) => project.name === name)?.id ?? null;
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

/** The `parsed` block `--json` reports, so a script can see what the text became. */
export function captureReport(result: CaptureResult) {
  return {
    title: result.title,
    ...captureFields(result),
    ...(result.projectName === null ? {} : { projectName: result.projectName }),
    ...(result.tagNames.length === 0 ? {} : { tagNames: [...result.tagNames] }),
    ...(result.unknownProjects.length === 0
      ? {}
      : { unknownProjects: [...result.unknownProjects] }),
    ...(result.unknownTags.length === 0
      ? {}
      : { unknownTags: [...result.unknownTags] }),
    spans: result.spans.map((span) => ({
      kind: span.kind,
      text: span.text,
      label: span.label,
      known: span.known,
    })),
  };
}
