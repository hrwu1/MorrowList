import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default function Page() {
  return <AuthForm mode="sign-up" />;
}
