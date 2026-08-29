import type { ReactNode } from "react";

import { AppNav } from "@/components/app-nav";

/** Authenticated shell: persistent navigation plus the main content region (spec 7.2). */
export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="app-shell">
      <AppNav />
      <main id="main" className="app-shell__main">
        {children}
      </main>
    </div>
  );
}
