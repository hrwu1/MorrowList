import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TaskDetail } from "@/features/tasks/components/task-detail";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

/**
 * Canonical task URL (spec 7.5). The side panel is a convenience on top of a list; this
 * is the address a task actually has, so a link to it works from anywhere, on any device,
 * and renders the full-page layout rather than a panel without its list.
 */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly idOrKey: string }>;
}) {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  const { idOrKey } = await params;

  return (
    <div className="stack">
      <nav aria-label="Breadcrumb">
        <Link className="task-page__back" href="/inbox">
          ← Back to Inbox
        </Link>
      </nav>
      <h1 className="ml-visually-hidden">Task {decodeURIComponent(idOrKey)}</h1>
      <TaskDetail idOrKey={decodeURIComponent(idOrKey)} variant="page" />
    </div>
  );
}
