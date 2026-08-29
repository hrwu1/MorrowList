import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { InboxPage } from "@/features/tasks/components/inbox-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

/**
 * The Inbox route. The session is checked on the server so an unauthenticated visitor is
 * redirected before any task data is fetched (spec 23.1).
 */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <InboxPage />;
}
