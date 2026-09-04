import { EmptyState } from "@morrowlist/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Offline" };

/**
 * The offline fallback route (spec 25.1). The service worker precaches this page and
 * serves it when a navigation fails and the requested page was never stored, so a lost
 * connection is explained rather than shown as a browser error.
 */
export default function OfflinePage() {
  return (
    <main id="main" className="app-shell__main">
      <EmptyState
        title="You're offline"
        description="This page has not been saved for offline use. Views you opened recently are still available; everything else needs a connection."
        action={
          <Link className="ml-button ml-button--primary" href="/today">
            Open Today
          </Link>
        }
      />
    </main>
  );
}
