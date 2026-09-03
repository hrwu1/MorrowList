"use client";

import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useTodayView } from "../hooks/use-today";
import { TODAY_SECTION_LABELS, formatDateHeading } from "../lib/today-view";

import { ReviewBanner } from "./review-banner";

import { TaskPanel } from "@/features/tasks/components/task-panel";
import { TaskRow } from "@/features/tasks/components/task-row";

/**
 * Today (spec 9.2): what needs attention and what was deliberately chosen. One request
 * returns the three sections and the review; the rows are the same rows as every list,
 * so completing, rescheduling, or re-prioritising here is the same action as anywhere.
 */
export function TodayPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date") ?? undefined;
  const openTaskKey = searchParams.get("task");
  const { data, isPending, isError, error, refetch } = useTodayView(requestedDate);

  const closePanel = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

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
  const sections = view?.sections.filter((section) => section.tasks.length > 0) ?? [];
  const total = sections.reduce((sum, section) => sum + section.tasks.length, 0);
  const isPastDay = Boolean(requestedDate);

  return (
    <div className="list-page">
      <div className="stack">
        <header className="page-header">
          <h1>{isPastDay ? "Plan" : "Today"}</h1>
          <p className="page-header__subtitle">
            {view ? formatDateHeading(view.date) : isPastDay ? requestedDate : " "}
            {isPastDay ? (
              <>
                {" · "}
                <Link href="/today">Back to today</Link>
              </>
            ) : null}
          </p>
        </header>

        {view?.review ? (
          <ReviewBanner date={view.review.date} tasks={view.review.tasks} />
        ) : null}

        {isPending ? (
          <div className="task-list__status">
            <Spinner label="Loading Today" />
          </div>
        ) : isError ? (
          <Alert tone="error" title="Today could not be loaded">
            <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
            <Button onClick={() => void refetch()}>Try again</Button>
          </Alert>
        ) : total === 0 ? (
          <EmptyState
            title={
              isPastDay ? "Nothing was planned for this day" : "Nothing needs you today"
            }
            description={
              isPastDay
                ? "No task was overdue, due, or chosen for this date."
                : "Nothing is overdue or due, and you have not chosen anything yet. Add a task to My Day from any list, card, or task to plan the day on purpose."
            }
          />
        ) : (
          sections.map((section) => (
            <section
              key={section.id}
              className="today-section"
              aria-labelledby={`today-${section.id}`}
            >
              <h2 id={`today-${section.id}`} className="today-section__heading">
                {TODAY_SECTION_LABELS[section.id]}
                <span className="today-section__count">{section.tasks.length}</span>
              </h2>
              <ul
                className="task-list"
                aria-label={`${TODAY_SECTION_LABELS[section.id]} tasks`}
              >
                {section.tasks.map((entry) => (
                  <TaskRow
                    key={entry.task.id}
                    task={entry.task}
                    detailHref={hrefFor(entry.task.key)}
                    selected={entry.task.key === openTaskKey}
                    today={view?.date}
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
