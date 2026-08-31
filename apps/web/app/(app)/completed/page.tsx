import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { HistoryNav } from "@/components/history-nav";
import { TaskListPage } from "@/features/tasks/components/task-list-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Completed" };
export const dynamic = "force-dynamic";

/** Completed tasks, most recently touched first (spec 9.6). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <div className="history-page stack">
      <HistoryNav />
      <Suspense>
        <TaskListPage
          scope="completed"
          heading="Completed"
          subtitle="Finished work across every project, kept here without crowding today's flow."
          emptyTitle="Nothing completed yet"
          emptyDescription="Completed tasks collect here as a quiet record of what moved forward."
          // The API cannot sort by completion time, so the closest honest proxy is the last
          // update, which completion is (spec 9.6).
          defaults={{ completion: "done", sort: "updatedAt", order: "desc" }}
        />
      </Suspense>
    </div>
  );
}
