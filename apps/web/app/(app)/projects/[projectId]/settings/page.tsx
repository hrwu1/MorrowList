import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ProjectSettingsPage } from "@/features/projects/components/project-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Project settings" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  const { projectId } = await params;
  return <ProjectSettingsPage projectId={projectId} />;
}
