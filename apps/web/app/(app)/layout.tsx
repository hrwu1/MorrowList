import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { getContainer } from "@/lib/server";

/** Authenticated shell: persistent navigation plus the main content region (spec 7.2). */
export default async function AppLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) redirect("/sign-in");

  return (
    <WorkspaceShell user={{ email: user.email, name: user.name }}>
      {children}
    </WorkspaceShell>
  );
}
