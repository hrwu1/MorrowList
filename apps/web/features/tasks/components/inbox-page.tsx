"use client";

import { useCompletedTasks } from "../hooks/use-tasks";

import { QuickAdd } from "./quick-add";
import { CompletedList, InboxList } from "./task-list";

/** The Inbox screen: capture, the open list, and what has been finished. */
export function InboxPage() {
  const completed = useCompletedTasks();

  return (
    <div className="stack">
      <section aria-labelledby="inbox-heading" className="stack">
        <header className="page-header">
          <h1 id="inbox-heading">Inbox</h1>
          <p className="page-header__subtitle">
            Everything you capture arrives here. Decide later; capture now.
          </p>
        </header>
        <QuickAdd />
        <InboxList />
      </section>

      <section aria-labelledby="completed-heading" className="stack">
        <h2 id="completed-heading" className="section-heading">
          Completed
        </h2>
        <CompletedList tasks={completed.data?.data ?? []} />
      </section>
    </div>
  );
}
