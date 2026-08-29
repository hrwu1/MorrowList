import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TaskListPage } from "@/features/tasks/components/task-list-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Completed" };
export const dynamic = "force-dynamic";

/** Completed tasks, most recently touched first (spec 9.6). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <Suspense>
      <TaskListPage
        scope="completed"
        heading="Completed"
        subtitle="Finished work, with its history intact. Reopening does not erase it."
        emptyTitle="Nothing completed yet"
        emptyDescription="Tasks you tick off collect here so you can see what a week actually contained."
        // The API cannot sort by completion time, so the closest honest proxy is the last
        // update, which completion is (spec 9.6).
        defaults={{ completion: "done", sort: "updatedAt", order: "desc" }}
      />
    </Suspense>
  );
}
