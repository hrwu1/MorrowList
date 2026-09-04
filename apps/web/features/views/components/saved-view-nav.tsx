"use client";

import Link from "next/link";

import { useReorderSavedView, useSavedViews } from "../hooks/use-saved-views";

/**
 * The sidebar "Views" section: the user's saved views in their order, each a link to
 * `/views/{id}`. Reordering is two buttons per view rather than a drag, so it works
 * the same with a keyboard, a pointer, and a screen reader (spec 14).
 */
export function SavedViewNav({
  pathname,
  onNavigate,
  reorderable = false,
}: {
  readonly pathname: string;
  readonly onNavigate?: (() => void) | undefined;
  readonly reorderable?: boolean | undefined;
}) {
  const views = useSavedViews();
  const reorder = useReorderSavedView();
  const items = views.data?.data ?? [];

  if (views.isPending || (items.length === 0 && !views.isError)) return null;

  return (
    <div className="workspace-views">
      <span className="workspace-nav__label">Views</span>
      {views.isError ? (
        <div className="workspace-projects__error" role="status">
          <span>Views unavailable</span>
          <button type="button" onClick={() => void views.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <ul className="workspace-views__list" aria-label="Saved views">
          {items.map((view, index) => {
            const href = `/views/${view.id}`;
            return (
              <li key={view.id} className="workspace-view">
                <Link
                  className="workspace-project-link"
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  {...(onNavigate ? { onClick: onNavigate } : {})}
                >
                  <span
                    className="workspace-view__mark"
                    data-layout={view.layout}
                    aria-hidden="true"
                  />
                  <span>{view.name}</span>
                </Link>
                {reorderable && items.length > 1 ? (
                  <span className="workspace-view__reorder">
                    <button
                      type="button"
                      aria-label={`Move ${view.name} up`}
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => reorder.mutate({ view, direction: "up" })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${view.name} down`}
                      disabled={index === items.length - 1 || reorder.isPending}
                      onClick={() => reorder.mutate({ view, direction: "down" })}
                    >
                      ↓
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {reorder.isError ? (
        <p className="workspace-drop-note" role="alert">
          The view could not be moved. It stayed where it was.
        </p>
      ) : null}
    </div>
  );
}
