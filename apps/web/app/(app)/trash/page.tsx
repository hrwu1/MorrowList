import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { HistoryNav } from "@/components/history-nav";
import { TaskListPage } from "@/features/tasks/components/task-list-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Trash" };
export const dynamic = "force-dynamic";

/**
 * Deleted tasks, restorable (spec 9.7). Permanent deletion is not implemented server-side,
 * so it is not offered here: a button that only appeared to work would be worse than none.
 */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <div className="history-page stack">
      <HistoryNav />
      <Suspense>
        <TaskListPage
          scope="trash"
          heading="Trash"
          subtitle="Deleted tasks stay recoverable here. Restore returns each one to its previous location."
          emptyTitle="The Trash is empty"
          emptyDescription="A deleted task waits here instead of disappearing. If restored, it returns to its previous project and stage—or to the Inbox if it came from there."
          defaults={{ completion: "any", sort: "updatedAt", order: "desc" }}
        />
      </Suspense>
    </div>
  );
}
