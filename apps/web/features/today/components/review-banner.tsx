"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { Alert, Button } from "@morrowlist/ui";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { DueDateInput } from "@/features/tasks/components/task-fields";
import { useAddToDay, useUpdateTask } from "@/features/tasks/hooks/use-tasks";

const DISMISSED_KEY = "morrowlist.today-review-dismissed";

/**
 * Remembers, per browser, which review day the user dismissed. A dismissal is a
 * convenience, not workspace state: another device shows the review again, and so does
 * the next day's (spec 9.2).
 */
function useDismissedReview(date: string) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === date);
    } catch {
      setDismissed(false);
    }
  }, [date]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, date);
    } catch {
      // Storage may be unavailable; the banner is simply hidden for this render.
    }
  }

  return { dismissed, dismiss };
}

/**
 * Yesterday's unfinished manual selections (spec 9.2). Nothing rolls forward on its own:
 * each task waits here until it is added to today, rescheduled, or the review is
 * dismissed.
 */
export function ReviewBanner({
  date,
  tasks,
}: {
  readonly date: string;
  readonly tasks: readonly TaskDto[];
}) {
  const { dismissed, dismiss } = useDismissedReview(date);
  const addToDay = useAddToDay();
  const update = useUpdateTask();
  const id = useId();

  if (dismissed || tasks.length === 0) return null;

  return (
    <Alert tone="info" title="Left over from yesterday">
      <p>
        {tasks.length === 1
          ? "One task you chose for yesterday is still open."
          : `${tasks.length} tasks you chose for yesterday are still open.`}{" "}
        Add them to today, pick a new date, or let them go.
      </p>
      <ul className="review-banner__tasks" aria-label="Unfinished from yesterday">
        {tasks.map((task) => (
          <li key={task.id} className="review-banner__task">
            <Link href={`/tasks/${encodeURIComponent(task.key)}`}>{task.title}</Link>
            <span className="task-row__key">{task.key}</span>
            <div className="review-banner__actions">
              <Button
                aria-label={`Add ${task.title} to today`}
                loading={addToDay.isPending && addToDay.variables?.id === task.id}
                onClick={() => addToDay.mutate(task)}
              >
                Add to today
              </Button>
              <label className="review-banner__reschedule">
                <span className="ml-visually-hidden">Reschedule {task.title}</span>
                <DueDateInput
                  id={`${id}-${task.id}`}
                  value={task.dueDate}
                  onChange={(dueDate) =>
                    update.mutate({
                      task,
                      patch:
                        dueDate === null
                          ? { dueDate: null, dueTime: null }
                          : { dueDate },
                    })
                  }
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <Button
          variant="primary"
          disabled={addToDay.isPending}
          onClick={() => {
            for (const task of tasks) addToDay.mutate(task);
          }}
        >
          Add all to today
        </Button>
        <Link className="review-banner__link" href={`/today?date=${date}`}>
          Open yesterday
        </Link>
        <Button variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </Alert>
  );
}
