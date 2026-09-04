"use client";

import { Button } from "@morrowlist/ui";

import { useOnline } from "../hooks/use-online";
import { useServiceWorker } from "../hooks/use-service-worker";

/**
 * The offline indicator and the update prompt (spec 25.1, 25.3). Both sit above every
 * route so the state is visible wherever the user is, and neither steals focus.
 */
export function OfflineStatus() {
  const online = useOnline();
  const { updateReady, applyUpdate, dismissUpdate } = useServiceWorker();

  return (
    <>
      {online ? null : (
        <div className="offline-banner" role="status" data-testid="offline-banner">
          <span className="offline-banner__dot" aria-hidden="true" />
          <span>
            <strong>You're offline.</strong>{" "}
            <span className="offline-banner__detail">
              Recently opened views still work; changes are paused until you're back
              online.
            </span>
          </span>
        </div>
      )}
      {updateReady ? (
        <div className="update-prompt" role="status" aria-live="polite">
          <span>A new version of MorrowList is ready.</span>
          <Button variant="primary" onClick={applyUpdate}>
            Reload
          </Button>
          <Button variant="ghost" onClick={dismissUpdate}>
            Later
          </Button>
        </div>
      ) : null}
    </>
  );
}
