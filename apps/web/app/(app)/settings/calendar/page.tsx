import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CalendarSettingsPage } from "@/features/calendar/components/calendar-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Calendar subscription" };
export const dynamic = "force-dynamic";

/** Manage the private calendar subscription (GAP-14). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <CalendarSettingsPage />;
}
