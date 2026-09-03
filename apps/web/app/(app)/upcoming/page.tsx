import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { UpcomingPage } from "@/features/upcoming/components/upcoming-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Upcoming" };
export const dynamic = "force-dynamic";

/** The Upcoming route (spec 9.3). */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <Suspense>
      <UpcomingPage />
    </Suspense>
  );
}
