"use client";

import type {
  MatchRangeDto,
  SearchProjectResultDto,
  SearchTaskResultDto,
} from "@morrowlist/contracts";
import Link from "next/link";

import { excerpt, segments } from "../lib/highlight";

import { PriorityBadge } from "@/features/tasks/components/task-fields";

/** Plain-text segments rendered as text; matched runs go inside a `<mark>` (spec 9.8). */
export function Highlighted({
  text,
  ranges,
}: {
  readonly text: string;
  readonly ranges: readonly MatchRangeDto[];
}) {
  return (
    <>
      {segments(text, ranges).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="search-mark">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export type SearchItem =
  | {
      readonly kind: "project";
      readonly href: string;
      readonly hit: SearchProjectResultDto;
    }
  | { readonly kind: "task"; readonly href: string; readonly hit: SearchTaskResultDto }
  | { readonly kind: "more"; readonly href: string; readonly label: string };

export function taskHref(hit: SearchTaskResultDto): string {
  return `/tasks/${encodeURIComponent(hit.task.key)}`;
}

export function projectHref(hit: SearchProjectResultDto): string {
  return `/projects/${hit.project.id}/board`;
}

export function itemId(listId: string, index: number): string {
  return `${listId}-item-${index}`;
}

/**
 * The result list. As a listbox (in the search dialog) the input owns focus and moves
 * the active option with the arrow keys; as a plain list (on the search page) every
 * result is an ordinary link.
 */
export function ResultList({
  id,
  items,
  activeIndex,
  onActivate,
  onChoose,
  label,
}: {
  readonly id: string;
  readonly items: readonly SearchItem[];
  /** Present in listbox mode; absent for a plain list of links. */
  readonly activeIndex?: number | undefined;
  readonly onActivate?: ((index: number) => void) | undefined;
  readonly onChoose?: ((item: SearchItem) => void) | undefined;
  readonly label: string;
}) {
  const listbox = activeIndex !== undefined;
  return (
    <ul
      id={id}
      className="search-results"
      role={listbox ? "listbox" : undefined}
      aria-label={label}
    >
      {items.map((item, index) => (
        <li
          key={itemId(id, index)}
          id={itemId(id, index)}
          className={`search-result search-result--${item.kind}`}
          role={listbox ? "option" : undefined}
          aria-selected={listbox ? index === activeIndex : undefined}
          onMouseMove={() => onActivate?.(index)}
        >
          <Link
            href={item.href}
            tabIndex={listbox ? -1 : undefined}
            onClick={() => onChoose?.(item)}
          >
            <ResultBody item={item} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ResultBody({ item }: { readonly item: SearchItem }) {
  if (item.kind === "more") {
    return <span className="search-result__more">{item.label}</span>;
  }
  if (item.kind === "project") {
    return (
      <>
        <span className="search-result__eyebrow">Project</span>
        <span className="search-result__title">
          <Highlighted text={item.hit.project.name} ranges={item.hit.matches} />
        </span>
      </>
    );
  }
  const { task, matches } = item.hit;
  const description = task.descriptionMd
    ? excerpt(task.descriptionMd, matches.description)
    : null;
  return (
    <>
      <span className="search-result__title" data-done={task.isCompleted || undefined}>
        <Highlighted text={task.title} ranges={matches.title} />
      </span>
      <span className="search-result__meta">
        <span className="task-row__key">{task.key}</span>
        <PriorityBadge priority={task.priority} />
        {task.dueDate ? <span>Due {task.dueDate}</span> : null}
        {task.isCompleted ? <span>Completed</span> : null}
        {task.tags.length > 0 ? (
          <span>{task.tags.map((tag) => `#${tag.name}`).join(" ")}</span>
        ) : null}
      </span>
      {description && matches.description.length > 0 ? (
        <span className="search-result__excerpt">
          <Highlighted text={description.text} ranges={description.ranges} />
        </span>
      ) : null}
    </>
  );
}
