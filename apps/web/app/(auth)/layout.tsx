import type { ReactNode } from "react";

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main" className="auth-shell">
      {children}
    </main>
  );
}
