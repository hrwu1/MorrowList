"use client";

import type { BoardViewQuery, SavedViewFilters } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { useId } from "react";

import { useSavedViews, useUpdateSavedView } from "../hooks/use-saved-views";

import { ViewBoardPage } from "@/features/board/components/view-board-page";
import { TaskListPage } from "@/features/tasks/components/task-list-page";
import { viewFromFilters } from "@/features/tasks/lib/task-view";

/**
 * The stored filter set is the task-list query; a board reads the same fields minus the
 * ones a board decides for itself — its order is manual rank and its columns are stages.
 */
function boardFilters(filters: SavedViewFilters): Partial<BoardViewQuery> {
  const { statusId: _statusId, sort: _sort, order: _order, ...shared } = filters;
  return { ...shared, source: "filters" };
}

/**
 * `/views/{id}` (spec 9.8): a saved view rendered through the shared list page with its
 * stored filters as the clean state, or as a board across projects when it is saved that
 * way (GAP-19).
 */
export function SavedViewPage({ viewId }: { readonly viewId: string }) {
  const views = useSavedViews();
  const update = useUpdateSavedView();
  const hintId = useId();
  const saved = views.data?.data.find((view) => view.id === viewId);

  if (views.isPending) {
    return (
      <div className="task-list__status">
        <Spinner label="Loading the view" />
      </div>
    );
  }

  if (views.isError) {
    return (
      <Alert tone="error" title="This view could not be loaded">
        <p>
          {views.error instanceof Error ? views.error.message : "Something went wrong."}
        </p>
        <Button onClick={() => void views.refetch()}>Try again</Button>
      </Alert>
    );
  }

  if (!saved) {
    return (
      <EmptyState
        title="No such view"
        description="It may have been deleted, or it belongs to another account. Saved views are personal."
        action={<Link href="/inbox">Back to Inbox</Link>}
      />
    );
  }

  const { scope, view } = viewFromFilters(saved.filters);
  const layoutToggle = (
    <fieldset className="saved-view-layout" aria-describedby={hintId}>
      <legend>Layout</legend>
      <Button
        variant={saved.layout === "list" ? "primary" : "secondary"}
        aria-pressed={saved.layout === "list"}
        disabled={update.isPending || saved.layout === "list"}
        onClick={() => update.mutate({ view: saved, patch: { layout: "list" } })}
      >
        List
      </Button>
      <Button
        variant={saved.layout === "board" ? "primary" : "secondary"}
        aria-pressed={saved.layout === "board"}
        disabled={update.isPending || saved.layout === "board"}
        onClick={() => update.mutate({ view: saved, patch: { layout: "board" } })}
      >
        Board
      </Button>
      <p id={hintId} className="saved-view-layout__hint">
        A board groups these tasks by the stage every project shares, so one view can
        span projects.
      </p>
    </fieldset>
  );

  if (saved.layout === "board") {
    return (
      <div className="stack">
        <header className="page-header">
          <h1>{saved.name}</h1>
          <p className="page-header__subtitle">
            A saved view of your tasks, drawn as a board.
          </p>
        </header>
        {layoutToggle}
        <ViewBoardPage
          scope={`view-${saved.id}`}
          heading={saved.name}
          filters={boardFilters(saved.filters)}
          emptyMessage="Tasks appear here as soon as one fits the saved filters."
        />
      </div>
    );
  }

  return (
    <TaskListPage
      key={saved.id}
      scope={scope}
      heading={saved.name}
      subtitle="A saved view of your tasks. Adjust the filters and update the view to keep them."
      emptyTitle="Nothing matches this view"
      emptyDescription="Tasks appear here as soon as one fits the saved filters."
      defaults={view}
      savedView={saved}
      toolbar={layoutToggle}
    />
  );
}
