import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WorkspaceSettingsPage } from "@/features/workspace/components/workspace-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Workspace" };
export const dynamic = "force-dynamic";

/** Workspace settings, including the cross-project in-progress limit (GAP-20). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <WorkspaceSettingsPage />;
}
