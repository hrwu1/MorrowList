"use client";

import { Alert, Button, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { useRef, useState } from "react";

import { useAddToDay, useTaskList } from "@/features/tasks/hooks/use-tasks";

/** An on-demand, paginated picker over the same tasks used by the Inbox and boards. */
export function TodayTaskChooser({
  date,
  onClose,
}: {
  readonly date: string;
  readonly onClose: () => void;
}) {
  const container = useRef<HTMLElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const tasks = useTaskList({
    isCompleted: false,
    deferred: false,
    sort: "rank",
    order: "asc",
    limit: 50,
    ...(cursor ? { cursor } : {}),
  });
  const add = useAddToDay();
  const available =
    tasks.data?.data.filter((task) => !task.dayPlans.includes(date)) ?? [];

  return (
    <section
      ref={container}
      className="today-chooser"
      aria-label="Choose tasks for today"
    >
      <div className="today-chooser__header">
        <div>
          <h2>Make room for what matters</h2>
          <p>Choose from your Inbox and projects.</p>
        </div>
        <Button ref={doneButton} onClick={onClose}>
          Done choosing
        </Button>
      </div>
      {tasks.isPending ? (
        <Spinner label="Loading available tasks" />
      ) : tasks.isError ? (
        <Alert tone="error" title="Tasks could not be loaded">
          <Button onClick={() => void tasks.refetch()}>Try again</Button>
        </Alert>
      ) : (
        <>
          {add.isError ? (
            <Alert tone="error" title="This task could not be added">
              <p>It is still available below. Try adding it again.</p>
            </Alert>
          ) : null}
          {available.length > 0 ? (
            <ul className="today-chooser__tasks">
              {available.map((task) => (
                <li key={task.id}>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.key}</small>
                  </span>
                  <Button
                    disabled={add.isPending}
                    aria-label={`Choose ${task.title} for today`}
                    data-choose-task
                    onClick={() =>
                      add.mutate(task, {
                        onSuccess: () => {
                          window.requestAnimationFrame(() => {
                            const next =
                              container.current?.querySelector<HTMLButtonElement>(
                                "[data-choose-task]:not(:disabled)",
                              ) ?? doneButton.current;
                            next?.focus();
                          });
                        },
                      })
                    }
                  >
                    Add to today
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {cursor || tasks.data?.page.hasMore
                ? "No more unselected tasks on this page."
                : "You have chosen all available tasks. Capture something new in your Inbox."}
            </p>
          )}
          <div className="button-row">
            {cursor ? (
              <Button onClick={() => setCursor(undefined)}>Back to first tasks</Button>
            ) : null}
            {tasks.data?.page.hasMore && tasks.data.page.nextCursor ? (
              <Button
                onClick={() => setCursor(tasks.data?.page.nextCursor ?? undefined)}
              >
                More tasks
              </Button>
            ) : null}
            {!cursor && !tasks.data?.page.hasMore && available.length === 0 ? (
              <Link href="/inbox">Open Inbox</Link>
            ) : null}
          </div>
        </>
      )}
      <output className="ml-visually-hidden" aria-live="polite">
        {add.isSuccess ? "Task added to today." : ""}
      </output>
    </section>
  );
}
