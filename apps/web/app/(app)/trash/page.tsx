import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

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
    <Suspense>
      <TaskListPage
        scope="trash"
        heading="Trash"
        subtitle="Deleted tasks are kept here and can be restored to the Inbox."
        emptyTitle="The Trash is empty"
        emptyDescription="Deleting a task moves it here rather than destroying it, so a mistake costs one click to undo."
        defaults={{ completion: "any", sort: "updatedAt", order: "desc" }}
      />
    </Suspense>
  );
}
