import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TodayPage } from "@/features/today/components/today-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** The Today route (spec 9.2): the daily loop's home and the default landing view. */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <Suspense>
      <TodayPage />
    </Suspense>
  );
}
