import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SavedViewPage } from "@/features/views/components/saved-view-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Saved view" };
export const dynamic = "force-dynamic";

/** A personal saved view (spec 9.8, GAP-02). */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly viewId: string }>;
}) {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  const { viewId } = await params;

  return (
    <Suspense>
      <SavedViewPage viewId={decodeURIComponent(viewId)} />
    </Suspense>
  );
}
