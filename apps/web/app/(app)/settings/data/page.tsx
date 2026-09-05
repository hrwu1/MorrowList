import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DataSettingsPage } from "@/features/data/components/data-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Data" };
export const dynamic = "force-dynamic";

/** Export the workspace, or import another tool's board (spec 30, GAP-07). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <DataSettingsPage />;
}
