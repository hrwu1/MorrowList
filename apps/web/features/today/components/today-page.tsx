"use client";

import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTodayView } from "../hooks/use-today";
import { TODAY_SECTION_LABELS, formatDateHeading } from "../lib/today-view";

import { ReviewBanner } from "./review-banner";
import { TodayFocus } from "./today-focus";
import { TodayTaskChooser } from "./today-task-chooser";

import "./today-studio.css";

import { ViewBoardPage } from "@/features/board/components/view-board-page";
import { TaskPanel } from "@/features/tasks/components/task-panel";
import { TaskRow } from "@/features/tasks/components/task-row";

/**
 * Today (spec 9.2): what needs attention and what was deliberately chosen. One request
 * returns the three sections and the review; the rows are the same rows as every list,
 * so completing, rescheduling, or re-prioritising here is the same action as anywhere.
 */
export function TodayPage() {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const chooseButton = useRef<HTMLButtonElement>(null);
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

  const layout = searchParams.get("layout") === "board" ? "board" : "list";

  function changeLayout(next: "list" | "board") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("layout");
    else params.set("layout", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const view = data?.data;
  const sections = view?.sections.filter((section) => section.tasks.length > 0) ?? [];
  const total = sections.reduce((sum, section) => sum + section.tasks.length, 0);
  const isPastDay = Boolean(requestedDate);
  const tasks = sections.flatMap((section) => section.tasks.map((entry) => entry.task));

  return (
    <div className="list-page studio-today">
      <div className="stack studio-today__content">
        <header className="studio-today-header">
          <div className="studio-today-header__eyebrow">
            <h1>{isPastDay ? "Plan" : "Today"}</h1>
            <span className="studio-today-header__divider" aria-hidden="true" />
            <p>
              {view ? formatDateHeading(view.date) : isPastDay ? requestedDate : " "}
              {isPastDay ? (
                <>
                  {" · "}
                  <Link href="/today">Back to today</Link>
                </>
              ) : null}
            </p>
          </div>
          {!isPastDay ? (
            <Button
              className="studio-today-choose"
              ref={chooseButton}
              aria-expanded={choosing}
              aria-controls="today-task-chooser"
              onClick={() => setChoosing((open) => !open)}
            >
              <span aria-hidden="true">+</span> Choose tasks for today
            </Button>
          ) : null}
        </header>

        {!isPastDay ? (
          <div className="studio-today-intro">
            <h2>
              A little clarity.
              <br />
              <em>A lighter day.</em>
            </h2>
            <p>
              A place for everything.
              <br />A little space for you.
            </p>
          </div>
        ) : null}

        {choosing && view && !isPastDay ? (
          <div id="today-task-chooser">
            <TodayTaskChooser
              date={view.date}
              onClose={() => {
                setChoosing(false);
                chooseButton.current?.focus();
              }}
            />
          </div>
        ) : null}

        {!isPastDay && view && !isError ? (
          <div className="studio-today-stage">
            <TodayFocus
              tasks={tasks}
              today={view.date}
              hrefFor={hrefFor}
              onChoose={() => {
                setChoosing(true);
                window.requestAnimationFrame(() => {
                  document
                    .getElementById("today-task-chooser")
                    ?.querySelector<HTMLHeadingElement>("h2")
                    ?.focus();
                });
              }}
            />
            <aside className="studio-breathe" aria-label="Make room for your day">
              <div className="studio-breathe__illustration" aria-hidden="true">
                <svg viewBox="0 0 180 120" fill="none">
                  <path d="M20 97h139M45 96c2-27 19-37 38-46 21-11 31-24 32-42 25 25 36 60 8 87" />
                  <path d="M76 95c2-20 10-36 22-50M88 66c-12-3-16-8-17-14M97 46c9 1 15-1 21-6M84 78c10 4 18 3 26 0" />
                  <circle cx="38" cy="32" r="13" />
                  <path d="M37 51v7M18 34h-7M22 18l-5-5M53 18l5-5" />
                </svg>
              </div>
              <p className="studio-breathe__eyebrow">A gentler kind of productive</p>
              <h3>Room to breathe.</h3>
              <p>
                You can hold a whole day here.
                <br />
                You only need to do one thing now.
              </p>
              <div className="studio-breathe__footer">
                <span className="studio-breathe__count">
                  {String(total).padStart(2, "0")}
                </span>
                <span>
                  {total === 1 ? "task in your day" : "tasks in your day"}
                  <br />
                  <strong>One at a time is plenty.</strong>
                </span>
              </div>
            </aside>
          </div>
        ) : null}

        <div className="studio-today-list-heading">
          <div>
            <p className="studio-today-list-heading__eyebrow">The bigger picture</p>
            <h2>{isPastDay ? "Your plan for this day" : "Your day, at a glance"}</h2>
          </div>
          <fieldset className="saved-view-layout" aria-label="Today layout">
            <legend className="ml-visually-hidden">Layout</legend>
            <Button
              variant={layout === "list" ? "primary" : "secondary"}
              aria-pressed={layout === "list"}
              onClick={() => changeLayout("list")}
            >
              List
            </Button>
            <Button
              variant={layout === "board" ? "primary" : "secondary"}
              aria-pressed={layout === "board"}
              onClick={() => changeLayout("board")}
            >
              Board
            </Button>
          </fieldset>
        </div>

        {view?.review ? (
          <ReviewBanner date={view.review.date} tasks={view.review.tasks} />
        ) : null}

        {layout === "board" ? (
          <ViewBoardPage
            scope="today"
            heading={isPastDay ? "Plan" : "Today"}
            filters={{
              source: "today",
              ...(requestedDate ? { date: requestedDate } : {}),
            }}
            emptyMessage="Nothing is overdue or due, and nothing has been chosen for today yet."
          />
        ) : isPending ? (
          <div className="task-list__status">
            <Spinner label="Loading Today" />
          </div>
        ) : isError ? (
          <Alert tone="error" title="Today could not be loaded">
            <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
            <Button onClick={() => void refetch()}>Try again</Button>
          </Alert>
        ) : total === 0 ? (
          choosing ? null : (
            <EmptyState
              title={
                isPastDay
                  ? "Nothing was planned for this day"
                  : "Nothing needs you today"
              }
              description={
                isPastDay
                  ? "No task was overdue, due, or chosen for this date."
                  : "Start with a few tasks that deserve your attention. Choose from your Inbox and projects above."
              }
            />
          )
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
