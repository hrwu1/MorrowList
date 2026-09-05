import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WebhookSettingsPage } from "@/features/webhooks/components/webhook-settings-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Webhooks" };
export const dynamic = "force-dynamic";

/** Webhook endpoints and their delivery log (GAP-18). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <WebhookSettingsPage />;
}
