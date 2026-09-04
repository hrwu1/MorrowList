import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NotificationListPage } from "@/features/notifications/components/notification-list-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/** The in-app notification inbox (GAP-13). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <NotificationListPage />;
}
