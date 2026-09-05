"use client";

import { Spinner } from "@morrowlist/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { chordLabel } from "../lib/keys";
import { rankCommands } from "../lib/match";
import {
  chordIsEnabled,
  isAvailable,
  type Command,
  type ShortcutContext,
} from "../lib/registry";

import {
  Highlighted,
  ResultList,
  itemId,
  projectHref,
  taskHref,
  type SearchItem,
} from "@/features/search/components/result-list";
import {
  SEARCH_DEBOUNCE_MS,
  searchErrorMessage,
  useDebounced,
} from "@/features/search/components/search-box";
import { useSearch } from "@/features/search/hooks/use-search";

/**
 * The command palette (GAP-10, spec 23.4).
 *
 * One dialog answers both halves of "what do I want to do": the commands the registry
 * knows about, matched fuzzily, and — once the typed text is long enough to be a search
 * and matches no command — the workspace itself, through the same `use-search` hook and
 * the same result rows the search dialog uses (spec 9.8). Whatever is highlighted runs or
 * opens on Enter; Escape closes and focus returns to where it came from.
 */

/** Below this, a stray letter is a mistyped command rather than a search. */
export const SEARCH_MIN_LENGTH = 3;
const RESULT_LIMIT = 6;

export function CommandPalette({
  commands,
  context,
  singleKeyEnabled,
  onDismiss,
}: {
  readonly commands: readonly Command[];
  readonly context: ShortcutContext;
  readonly singleKeyEnabled: boolean;
  readonly onDismiss: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
    };
  }, []);

  const available = useMemo(
    () => commands.filter((command) => isAvailable(command, context)),
    [commands, context],
  );
  const matches = useMemo(() => rankCommands(available, query), [available, query]);

  // Search only takes over when the words are not a command; that keeps "complete" a
  // command rather than a query, which is what a person pressing Ctrl+K expects.
  const searchable =
    matches.length === 0 && query.trim().length >= SEARCH_MIN_LENGTH ? query.trim() : "";
  const debounced = useDebounced(searchable, SEARCH_DEBOUNCE_MS);
  const results = useSearch(debounced, {}, { limit: RESULT_LIMIT });
  const page = results.data?.pages[0];

  const items = useMemo<SearchItem[]>(() => {
    if (!page || debounced.length === 0) return [];
    const list: SearchItem[] = [
      ...page.data.projects.map((hit) => ({
        kind: "project" as const,
        href: projectHref(hit),
        hit,
      })),
      ...page.data.tasks.map((hit) => ({
        kind: "task" as const,
        href: taskHref(hit),
        hit,
      })),
    ];
    if (list.length > 0) {
      list.push({
        kind: "more",
        href: `/search?q=${encodeURIComponent(debounced)}`,
        label: page.page.hasMore ? "See all results" : "Open as a page with filters",
      });
    }
    return list;
  }, [debounced, page]);

  const optionCount = matches.length > 0 ? matches.length : items.length;
  useEffect(() => setActiveIndex(0), [optionCount, query]);

  function choose(index: number) {
    const match = matches[index];
    if (match) {
      onDismiss();
      void match.command.run();
      return;
    }
    const item = items[index];
    if (item) {
      onDismiss();
      router.push(item.href);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
    } else if (event.key === "ArrowDown" && optionCount > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % optionCount);
    } else if (event.key === "ArrowUp" && optionCount > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (optionCount > 0) choose(activeIndex);
    }
  }

  const searching =
    debounced.length > 0 && (results.isPending || searchable !== debounced);
  const nothing =
    matches.length === 0 &&
    items.length === 0 &&
    query.trim().length > 0 &&
    !searching &&
    !results.isError;

  return (
    <dialog
      ref={dialogRef}
      className="search-dialog"
      aria-labelledby="command-palette-title"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="search-dialog__surface">
        <h2 id="command-palette-title" className="ml-visually-hidden">
          Command palette
        </h2>
        <div className="search-dialog__field">
          <label className="ml-visually-hidden" htmlFor={`${listId}-input`}>
            Run a command or search
          </label>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            className="search-dialog__input"
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            placeholder="Run a command, or type to search…"
            value={query}
            aria-expanded={optionCount > 0}
            aria-controls={listId}
            aria-activedescendant={
              optionCount > 0 ? itemId(listId, activeIndex) : undefined
            }
            aria-autocomplete="list"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {searching ? <Spinner label="Searching" /> : null}
        </div>

        {matches.length > 0 ? (
          <ul id={listId} className="search-results" role="listbox" aria-label="Commands">
            {matches.map(({ command, ranges }, index) => (
              <li
                key={command.id}
                id={itemId(listId, index)}
                className="search-result palette-command"
                role="option"
                aria-selected={index === activeIndex}
                onMouseMove={() => setActiveIndex(index)}
              >
                <button
                  type="button"
                  className="palette-command__button"
                  tabIndex={-1}
                  onClick={() => choose(index)}
                >
                  <span className="search-result__eyebrow">{command.group}</span>
                  <span className="search-result__title">
                    <Highlighted text={command.title} ranges={ranges} />
                  </span>
                  <span className="palette-command__keys">
                    {command.keys
                      .filter((chord) =>
                        chordIsEnabled(command, chord, { singleKeyEnabled }),
                      )
                      .map((chord) => (
                        <kbd key={chord}>{chordLabel(chord)}</kbd>
                      ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : items.length > 0 ? (
          <ResultList
            id={listId}
            items={items}
            activeIndex={activeIndex}
            onActivate={setActiveIndex}
            onChoose={() => onDismiss()}
            label="Search results"
          />
        ) : results.isError ? (
          <p className="search-dialog__note" role="alert">
            {searchErrorMessage(results.error)}
          </p>
        ) : nothing ? (
          <p className="search-dialog__note" role="status">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          <p className="search-dialog__note">
            Type a command such as <code>complete</code> or <code>today</code>. Three
            letters or more that match no command search your tasks instead.
          </p>
        )}

        <p className="search-dialog__keys" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close ·{" "}
          <kbd>?</kbd> all shortcuts
        </p>
      </div>
    </dialog>
  );
}
