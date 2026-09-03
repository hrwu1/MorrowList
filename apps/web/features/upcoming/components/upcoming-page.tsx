"use client";

import type { UpcomingHorizon } from "@morrowlist/contracts";
import { UPCOMING_HORIZONS } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Select, Spinner } from "@morrowlist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef } from "react";

import { useUpcomingView } from "../hooks/use-upcoming";
import {
  DEFAULT_HORIZON,
  HORIZON_LABELS,
  formatGroupDate,
  readHorizon,
} from "../lib/upcoming-view";

import { TaskPanel } from "@/features/tasks/components/task-panel";
import { TaskRow } from "@/features/tasks/components/task-row";

/**
 * Upcoming (spec 9.3): future work grouped by due date, with the horizon in the URL so a
 * chosen range survives a reload. Rescheduling is the row's own due-date field.
 */
export function UpcomingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const horizon = readHorizon(new URLSearchParams(searchParams.toString()));
  const openTaskKey = searchParams.get("task");
  const { data, isPending, isError, error, refetch } = useUpcomingView(horizon);
  const horizonId = useId();

  const navigate = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  function changeHorizon(next: UpcomingHorizon) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_HORIZON) params.delete("horizon");
    else params.set("horizon", next);
    navigate(params);
  }

  const closePanel = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    navigate(next);
  }, [navigate, searchParams]);

  const lastOpen = useRef<string | null>(openTaskKey);
  useEffect(() => {
    const previous = lastOpen.current;
    lastOpen.current = openTaskKey;
    if (previous && !openTaskKey) {
      document.getElementById(`task-link-${previous}`)?.focus();
    }
  }, [openTaskKey]);

  function hrefFor(taskKey: string): string {
    const next = new URLSearchParams(searchParams.toString());
    next.set("task", taskKey);
    return `${pathname}?${next.toString()}`;
  }

  const view = data?.data;
  const groups = view?.groups ?? [];

  return (
    <div className="list-page">
      <div className="stack">
        <header className="page-header">
          <h1>Upcoming</h1>
          <p className="page-header__subtitle">
            What is due after today, one day at a time.
          </p>
        </header>

        <section className="filters upcoming-controls" aria-label="Upcoming controls">
          <label className="ml-field__label" htmlFor={horizonId}>
            Horizon
          </label>
          <Select
            id={horizonId}
            value={horizon}
            onChange={(event) => changeHorizon(event.target.value as UpcomingHorizon)}
          >
            {UPCOMING_HORIZONS.map((option) => (
              <option key={option} value={option}>
                {HORIZON_LABELS[option]}
              </option>
            ))}
          </Select>
        </section>

        {view?.truncated ? (
          <Alert tone="info" title="Showing the first 500 upcoming tasks">
            Narrow the horizon to see everything in a range.
          </Alert>
        ) : null}

        {isPending ? (
          <div className="task-list__status">
            <Spinner label="Loading Upcoming" />
          </div>
        ) : isError ? (
          <Alert tone="error" title="Upcoming could not be loaded">
            <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
            <Button onClick={() => void refetch()}>Try again</Button>
          </Alert>
        ) : groups.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description={`No open task is due in the ${HORIZON_LABELS[horizon].toLowerCase()}. Give a task a due date and it will appear here.`}
          />
        ) : (
          groups.map((group) => (
            <section
              key={group.date}
              className="upcoming-group"
              aria-labelledby={`upcoming-${group.date}`}
            >
              <h2 id={`upcoming-${group.date}`} className="today-section__heading">
                <time dateTime={group.date}>
                  {formatGroupDate(group.date, view?.from ?? group.date)}
                </time>
                <span className="today-section__count">{group.tasks.length}</span>
              </h2>
              <ul className="task-list" aria-label={`Tasks due ${group.date}`}>
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    detailHref={hrefFor(task.key)}
                    selected={task.key === openTaskKey}
                    today={view?.from}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {openTaskKey ? <TaskPanel idOrKey={openTaskKey} onClose={closePanel} /> : null}
    </div>
  );
}
