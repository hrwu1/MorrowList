import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { TagSettingsPage } from "@/features/tags/components/tag-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Tags" };
export const dynamic = "force-dynamic";

/** Workspace tag management (spec 12.1). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <TagSettingsPage />;
}
