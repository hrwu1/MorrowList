import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ProjectListPage } from "@/features/projects/components/project-list-page";
import { getContainer } from "@/lib/server";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return <ProjectListPage />;
}
