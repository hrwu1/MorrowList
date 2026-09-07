import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";
import { captureReturnTo } from "@/features/capture/lib/share";

export const metadata: Metadata = { title: "Sign in" };

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<{ returnTo?: string }>;
}) {
  const returnTo = captureReturnTo((await searchParams).returnTo);
  return <AuthForm mode="sign-in" returnTo={returnTo} />;
}
