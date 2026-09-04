"use client";

import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { useId } from "react";

import { useSavedViews, useUpdateSavedView } from "../hooks/use-saved-views";

import { TaskListPage } from "@/features/tasks/components/task-list-page";
import { viewFromFilters } from "@/features/tasks/lib/task-view";

/**
 * `/views/{id}` (spec 9.8): a saved view rendered through the shared list page with its
 * stored filters as the clean state. Board layout is stored and shown, but renders as
 * the list until cross-project boards land (GAP-19); the toggle says so.
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
      toolbar={
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
            aria-disabled="true"
            title="Board layout for saved views arrives with cross-project boards."
            onClick={(event) => event.preventDefault()}
          >
            Board
          </Button>
          <p id={hintId} className="saved-view-layout__hint">
            {saved.layout === "board"
              ? "This view is saved as a board. Until cross-project boards land it is shown as a list."
              : "Board layout for saved views arrives with cross-project boards."}
          </p>
        </fieldset>
      }
    />
  );
}
