"use client";

import { ApiClientError } from "@morrowlist/api-client";
import { Spinner } from "@morrowlist/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useSearch } from "../hooks/use-search";

import {
  ResultList,
  itemId,
  projectHref,
  taskHref,
  type SearchItem,
} from "./result-list";

/** How long typing pauses before a request goes out (spec 9.8, debounced search). */
export const SEARCH_DEBOUNCE_MS = 250;
const DIALOG_RESULT_LIMIT = 8;

export function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** What the server said about a failed search, in words a person can act on. */
export function searchErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "VALIDATION_FAILED" && error.message.startsWith("Unknown")) {
      return error.message;
    }
    if (error.status === 403 || error.status === 404) {
      return "You do not have access to search this workspace.";
    }
  }
  return "Search is unavailable right now. Try again in a moment.";
}

/**
 * The search dialog (spec 9.8): opened from the sidebar or with `/`. The input keeps
 * focus; arrows move through the listbox, Enter opens the active result, Escape
 * closes. "See all results" leads to the search page, where the query and filters
 * live in the URL.
 */
export function SearchBox({ onDismiss }: { readonly onDismiss: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const results = useSearch(debounced, {}, { limit: DIALOG_RESULT_LIMIT });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
    };
  }, []);

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
  }, [page, debounced]);

  useEffect(() => setActiveIndex(0), [items]);

  function choose(item: SearchItem | undefined) {
    if (!item) return;
    onDismiss();
    router.push(item.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // A search input clears itself on Escape before the dialog ever sees the key;
      // Escape means close here, whatever the field holds.
      event.preventDefault();
      onDismiss();
    } else if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (items.length > 0) choose(items[activeIndex]);
      else if (query.trim())
        choose({
          kind: "more",
          href: `/search?q=${encodeURIComponent(query.trim())}`,
          label: "",
        });
    }
  }

  const searching =
    debounced.length > 0 && (results.isPending || query.trim() !== debounced);
  const empty =
    debounced.length > 0 && !searching && !results.isError && items.length === 0;

  return (
    <dialog
      ref={dialogRef}
      className="search-dialog"
      aria-labelledby="search-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="search-dialog__surface">
        <h2 id="search-dialog-title" className="ml-visually-hidden">
          Search
        </h2>
        <div className="search-dialog__field">
          <label className="ml-visually-hidden" htmlFor={`${listId}-input`}>
            Search tasks and projects
          </label>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            className="search-dialog__input"
            type="search"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search tasks, keys, tags… try due:overdue"
            value={query}
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              items.length > 0 ? itemId(listId, activeIndex) : undefined
            }
            aria-autocomplete="list"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {searching ? <Spinner label="Searching" /> : null}
        </div>

        {items.length > 0 ? (
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
        ) : empty ? (
          <p className="search-dialog__note" role="status">
            No matches for “{debounced}”.
          </p>
        ) : (
          <p className="search-dialog__note">
            Words match titles, descriptions and tag names; a key such as ML-12 opens
            the task. Operators: <code>due:overdue</code> <code>priority:high</code>{" "}
            <code>tag:research</code> <code>is:blocked</code> <code>in:inbox</code>.
          </p>
        )}
        <p className="search-dialog__keys" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
        </p>
      </div>
    </dialog>
  );
}
