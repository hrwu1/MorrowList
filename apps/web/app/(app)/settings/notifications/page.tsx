import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NotificationPreferencesPage } from "@/features/notifications/components/notification-preferences-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

/** Channels, digest, and default reminder (GAP-13). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <NotificationPreferencesPage />;
}
