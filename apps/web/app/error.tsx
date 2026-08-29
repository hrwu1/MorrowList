"use client";

import { Alert, Button } from "@morrowlist/ui";

/**
 * Route-level error boundary (FND-007, spec 23.6). The user is told what to do next; the
 * underlying error stays in the server logs, correlated by request ID.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main id="main" className="app-shell__main">
      <Alert tone="error" title="Something went wrong">
        <p>
          The page could not be displayed. Your data has not been changed.
          {error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <Button onClick={reset}>Try again</Button>
      </Alert>
    </main>
  );
}
