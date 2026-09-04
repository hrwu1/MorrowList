import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SearchPage } from "@/features/search/components/search-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

/** The search route (spec 9.8): query and filters live in the URL. */
export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
