"use client";

import { Alert, Button, EmptyState, Spinner, TextInput } from "@morrowlist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { useSearch } from "../hooks/use-search";

import { ResultList, projectHref, taskHref, type SearchItem } from "./result-list";
import { searchErrorMessage } from "./search-box";

import {
  readTaskView,
  toListQuery,
  writeTaskView,
  DEFAULT_VIEW,
  type TaskView,
} from "@/features/tasks/lib/task-view";
import { FilterPanel } from "@/features/views/components/filter-panel";

/**
 * The search page (spec 9.8): the query and every filter live in the URL, so a search
 * can be shared or reloaded, and pages are appended under a cursor. Sorting is by
 * relevance, so the panel's sort controls are hidden here.
 */
export function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const q = params.get("q")?.trim() ?? "";
  const view = readTaskView(params);
  const inputId = useId();
  const listId = useId();
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const filters = useMemo(() => {
    const { sort: _sort, order: _order, ...rest } = toListQuery("all", view);
    return rest;
  }, [view]);
  const results = useSearch(q, filters);

  function navigate(next: URLSearchParams) {
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (draft.trim()) next.set("q", draft.trim());
    else next.delete("q");
    navigate(next);
  }

  function changeView(next: TaskView) {
    navigate(new URLSearchParams(writeTaskView(next, DEFAULT_VIEW, params)));
  }

  const pages = results.data?.pages ?? [];
  const items: SearchItem[] = [
    ...(pages[0]?.data.projects ?? []).map((hit) => ({
      kind: "project" as const,
      href: projectHref(hit),
      hit,
    })),
    ...pages.flatMap((page) =>
      page.data.tasks.map((hit) => ({
        kind: "task" as const,
        href: taskHref(hit),
        hit,
      })),
    ),
  ];
  const taskCount = pages.reduce((sum, page) => sum + page.data.tasks.length, 0);

  return (
    <div className="stack">
      <header className="page-header">
        <h1>Search</h1>
        <p className="page-header__subtitle">
          Words match titles, descriptions and tag names. Operators such as{" "}
          <code>due:overdue</code> or <code>tag:research</code> narrow the results.
        </p>
      </header>

      <form className="search-page__form" role="search" onSubmit={submit}>
        <label className="ml-visually-hidden" htmlFor={inputId}>
          Search query
        </label>
        <TextInput
          id={inputId}
          type="search"
          value={draft}
          placeholder="Search tasks, keys, tags…"
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      <FilterPanel
        scope="all"
        view={view}
        onChange={changeView}
        showSort={false}
        allowSave={false}
        resultCount={taskCount}
      />

      {q.length === 0 ? (
        <EmptyState
          title="Type something to search"
          description="Try a word from a title, a task key such as ML-000012, or a tag name."
        />
      ) : results.isPending ? (
        <div className="task-list__status">
          <Spinner label="Searching" />
        </div>
      ) : results.isError ? (
        <Alert tone="error" title="Search failed">
          <p>{searchErrorMessage(results.error)}</p>
          <Button onClick={() => void results.refetch()}>Try again</Button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title={`No matches for “${q}”`}
          description="Check the spelling, or loosen a filter."
        />
      ) : (
        <>
          <ResultList id={listId} items={items} label="Search results" />
          {results.hasNextPage ? (
            <div className="search-page__more">
              <Button
                onClick={() => void results.fetchNextPage()}
                loading={results.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
