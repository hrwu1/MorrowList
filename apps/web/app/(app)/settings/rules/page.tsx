import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RuleSettingsPage } from "@/features/rules/components/rule-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Automation rules" };
export const dynamic = "force-dynamic";

/** Personal automation settings and run log (GAP-21). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <RuleSettingsPage />;
}
