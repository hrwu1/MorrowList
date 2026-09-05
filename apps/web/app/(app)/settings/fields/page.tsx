import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { FieldSettingsPage } from "@/features/fields/components/field-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Custom fields" };
export const dynamic = "force-dynamic";

/** Workspace typed custom-field management (GAP-24). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <FieldSettingsPage />;
}
