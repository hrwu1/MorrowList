"use client";

import { useDndMonitor, useDraggable, useDroppable } from "@dnd-kit/core";
import type { TaskDto } from "@morrowlist/contracts";
import { Alert, Button, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useCalendar } from "../hooks/use-calendar";
import {
  calendarDays,
  calendarLabel,
  shiftDate,
  shiftPeriod,
  taskOnDate,
  validCalendarDate,
  type CalendarLayout,
} from "../lib/calendar-view";

import { QuickAdd } from "@/features/tasks/components/quick-add";
import { TaskPanel } from "@/features/tasks/components/task-panel";
import { TaskRow } from "@/features/tasks/components/task-row";
import { useUpdateTask } from "@/features/tasks/hooks/use-tasks";
import { readDraggedTask } from "@/features/tasks/lib/task-dnd";
import { localToday } from "@/features/today/lib/today-view";
import { useDefaultWorkspace } from "@/features/workspace/hooks/use-workspace";
import "./calendar.css";

export function CalendarPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspace = useDefaultWorkspace();
  const today = workspace
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: workspace.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    : localToday();
  const rawDate = params.get("date");
  const anchor = validCalendarDate(rawDate) ? rawDate : today;
  const layout: CalendarLayout = params.get("layout") === "week" ? "week" : "month";
  const days = calendarDays(anchor, layout);
  const query = useCalendar(days[0]!, days.at(-1)!);
  const update = useUpdateTask();
  const [selected, setSelected] = useState<string | null>(null);
  const day = selected && days.includes(selected) ? selected : anchor;
  const [capture, setCapture] = useState(false);
  const focusDay = useRef<string | null>(null);
  const openTask = params.get("task");
  const previousTask = useRef(openTask);
  useEffect(() => {
    const previous = previousTask.current;
    previousTask.current = openTask;
    if (previous && !openTask) {
      const row = document.getElementById(`task-link-${previous}`);
      const chip = document.querySelector<HTMLElement>(
        `[data-calendar-task-key="${CSS.escape(previous)}"]`,
      );
      const target =
        row ??
        (chip?.getClientRects().length
          ? chip
          : document.querySelector<HTMLElement>(".calendar-day[data-selected] button"));
      target?.focus();
    }
  }, [openTask]);
  const tasks = query.data?.data.tasks ?? [];
  const selectedTasks = tasks.filter((task) => taskOnDate(task, day));
  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  useEffect(() => {
    if (focusDay.current) {
      const target = document.getElementById(`calendar-day-${focusDay.current}`);
      if (target) {
        target.focus();
        focusDay.current = null;
      }
    }
  });
  function select(date: string, quickAdd = false) {
    setSelected(date);
    setCapture(quickAdd);
  }
  function keyDay(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
      event.key
    ];
    if (offset === undefined) return;
    event.preventDefault();
    const next = shiftDate(date, offset);
    focusDay.current = next;
    select(next);
    if (!days.includes(next)) navigate({ date: next });
  }
  useDndMonitor({
    onDragEnd(event) {
      const task = readDraggedTask(event.active);
      const target = event.over?.data.current;
      if (
        !task ||
        target?.type !== "calendar-day" ||
        update.isPending ||
        task.dueDate === target.date
      )
        return;
      select(target.date);
      update.mutate({ task, patch: { dueDate: target.date } });
    },
  });
  function href(task: TaskDto) {
    const next = new URLSearchParams(params.toString());
    next.set("task", task.key);
    return `${pathname}?${next}`;
  }
  return (
    <div className="list-page calendar-page">
      <div className="stack">
        <header className="page-header">
          <h1>Calendar</h1>
          <p className="page-header__subtitle">
            Planned days, deadlines, and when deferred work becomes available.
          </p>
        </header>
        <div className="calendar-controls" aria-label="Calendar controls">
          <Button
            aria-label={`Previous ${layout}`}
            onClick={() => navigate({ date: shiftPeriod(anchor, layout, -1) })}
          >
            Previous
          </Button>
          <Button
            onClick={() => {
              select(today);
              navigate({ date: today });
            }}
          >
            Today
          </Button>
          <Button
            aria-label={`Next ${layout}`}
            onClick={() => navigate({ date: shiftPeriod(anchor, layout, 1) })}
          >
            Next
          </Button>
          <h2>
            {layout === "month"
              ? new Intl.DateTimeFormat("en", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${anchor}T12:00:00Z`))
              : `Week of ${days[0]}`}
          </h2>
          <div className="calendar-layout" role="group" aria-label="Calendar layout">
            {(["month", "week"] as const).map((mode) => (
              <Button
                key={mode}
                aria-pressed={layout === mode}
                onClick={() => navigate({ layout: mode, date: day })}
              >
                {mode === "month" ? "Month" : "Week"}
              </Button>
            ))}
          </div>
          <Link href="/settings/calendar">Subscribe</Link>
        </div>
        {update.isError ? (
          <Alert tone="error" title="Task could not be rescheduled">
            {update.error.message}
          </Alert>
        ) : null}
        {query.isError ? (
          <Alert tone="error" title="Calendar could not be loaded">
            <p>{query.error.message}</p>
            <Button onClick={() => void query.refetch()}>Try again</Button>
          </Alert>
        ) : null}
        {query.isPending ? <Spinner label="Loading calendar" /> : null}
        {query.data?.data.truncated ? (
          <Alert tone="info" title="Showing the first 2,000 scheduled tasks">
            Switch to Week to narrow this range.
          </Alert>
        ) : null}
        <p className="calendar-hint">
          Select a day to add a task. Use arrow keys between days. Drag a task to change
          its planned day, or edit its Planned date below.
        </p>
        <div
          className="calendar-grid"
          aria-label={`${layout === "month" ? "Month" : "Week"} calendar`}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div className="calendar-weekday" key={label}>
              {label}
            </div>
          ))}
          {days.map((date) => (
            <CalendarDay
              key={date}
              date={date}
              selected={date === day}
              today={date === today}
              outside={layout === "month" && date.slice(0, 7) !== anchor.slice(0, 7)}
              tasks={tasks.filter((task) => taskOnDate(task, date))}
              href={href}
              onSelect={() => select(date, true)}
              onKeyDown={(event) => keyDay(event, date)}
            />
          ))}
        </div>
        <section className="stack calendar-day-list" aria-label={`Tasks on ${day}`}>
          <h2>{calendarLabel(day)}</h2>
          <QuickAdd key={day} initialDueDate={day} autoFocus={capture} />
          {selectedTasks.length ? (
            <ul className="task-list">
              {selectedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  detailHref={href(task)}
                  today={today}
                />
              ))}
            </ul>
          ) : (
            <p>No tasks on this day.</p>
          )}
        </section>
      </div>
      {openTask ? (
        <TaskPanel idOrKey={openTask} onClose={() => navigate({ task: null })} />
      ) : null}
    </div>
  );
}

function CalendarDay({
  date,
  tasks,
  selected,
  today,
  outside,
  onSelect,
  onKeyDown,
  href,
}: {
  date: string;
  tasks: TaskDto[];
  selected: boolean;
  today: boolean;
  outside: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  href: (task: TaskDto) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day:${date}`,
    data: { type: "calendar-day", date },
  });
  return (
    <section
      ref={setNodeRef}
      className="calendar-day"
      data-date={date}
      data-selected={selected || undefined}
      data-over={isOver || undefined}
      data-outside={outside || undefined}
      aria-label={calendarLabel(date)}
    >
      <button
        id={`calendar-day-${date}`}
        className="calendar-day__date"
        type="button"
        tabIndex={selected ? 0 : -1}
        aria-label={`Add task on ${date}`}
        aria-current={today ? "date" : undefined}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <time dateTime={date}>{Number(date.slice(-2))}</time>
        <span className="calendar-day__count">{tasks.length || ""}</span>
      </button>
      <div className="calendar-chips">
        {tasks.slice(0, 3).map((task) => (
          <CalendarChip key={task.id} task={task} date={date} href={href(task)} />
        ))}
        {tasks.length > 3 ? (
          <button className="calendar-more" onClick={onSelect}>
            +{tasks.length - 3} more
          </button>
        ) : null}
      </div>
    </section>
  );
}
function CalendarChip({
  task,
  date,
  href,
}: {
  task: TaskDto;
  date: string;
  href: string;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `calendar-chip:${task.id}:${date}`,
    data: { type: "task", task },
  });
  const marker =
    task.deadline === date
      ? "Deadline"
      : task.dueDate === date
        ? "Planned"
        : "Available";
  return (
    <div
      ref={setNodeRef}
      className="calendar-chip"
      data-dragging={isDragging || undefined}
    >
      <button
        type="button"
        className="calendar-chip__drag"
        {...listeners}
        {...attributes}
        aria-label={`Reschedule ${task.title}`}
      >
        ⋮
      </button>
      <Link
        href={href}
        data-calendar-task-key={task.key}
        title={`${marker}: ${task.title}`}
      >
        <span className="calendar-chip__marker">{marker}</span>
        <span>{task.title}</span>
      </Link>
    </div>
  );
}
