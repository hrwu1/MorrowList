import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { KanbanBoardPage } from "@/features/board/components/kanban-board-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Project board" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  const { projectId } = await params;
  return (
    <Suspense>
      <KanbanBoardPage projectId={projectId} />
    </Suspense>
  );
}
