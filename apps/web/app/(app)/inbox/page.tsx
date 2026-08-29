import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TaskListPage } from "@/features/tasks/components/task-list-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

/**
 * The Inbox route (spec 9.1). The session is checked on the server so an unauthenticated
 * visitor is redirected before any task data is fetched (spec 23.1).
 */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    // The list reads its filters from the URL, which is client state; the boundary keeps
    // the server render from waiting on it.
    <Suspense>
      <TaskListPage
        scope="inbox"
        heading="Inbox"
        subtitle="Everything you capture arrives here. Decide later; capture now."
        emptyTitle="Your Inbox is clear"
        emptyDescription="Anything you capture lands here first. Sort it into a project when you are ready — not before."
        showQuickAdd
      />
    </Suspense>
  );
}
