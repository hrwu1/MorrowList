import { EmptyState } from "@morrowlist/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="app-shell__main">
      <EmptyState
        title="Page not found"
        description="That view does not exist, or it has moved."
        action={
          <Link className="ml-button ml-button--primary" href="/inbox">
            Go to your Inbox
          </Link>
        }
      />
    </main>
  );
}
