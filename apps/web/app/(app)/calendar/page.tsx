import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CalendarPage } from "@/features/calendar/components/calendar-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

/** The calendar projection (GAP-14). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  );
}
