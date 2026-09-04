"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { registerServiceWorker, serviceWorkerSupported } from "../lib/service-worker";

/**
 * Registers the worker and surfaces a waiting update (spec 25.3). The new worker never
 * takes over on its own: the page reloads only after the user asks for the update, so an
 * edit in progress is not lost to a background activation.
 */
export function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const reloadRequested = useRef(false);

  useEffect(() => {
    if (!serviceWorkerSupported()) return undefined;
    let cancelled = false;

    function watch(installing: ServiceWorker) {
      installing.addEventListener("statechange", () => {
        // "installed" with a controller present means a previous version is still in
        // charge and this one is waiting; on a first install there is nothing to prompt.
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setWaiting(installing);
        }
      });
    }

    void registerServiceWorker().then((registration) => {
      if (!registration || cancelled) return;
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting);
      }
      if (registration.installing) watch(registration.installing);
      registration.addEventListener("updatefound", () => {
        if (registration.installing) watch(registration.installing);
      });
    });

    function onControllerChange() {
      if (reloadRequested.current) window.location.reload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    reloadRequested.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  return {
    updateReady: waiting !== null && !dismissed,
    applyUpdate,
    dismissUpdate: () => setDismissed(true),
  };
}
