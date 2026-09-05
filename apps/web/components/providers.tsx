"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { OfflineStatus } from "@/features/offline/components/offline-status";
import { ShortcutsProvider } from "@/features/shortcuts/components/shortcuts-provider";
import { UndoProvider } from "@/features/tasks/components/undo-toast";

/**
 * Server-state configuration (spec 23.1, 24.3).
 *
 * Real-time push is deferred for the MVP, so consistency comes from refetching on focus
 * and reconnect rather than from a socket. Requests are attempted even when the browser
 * reports itself offline (spec 25.1): the service worker answers a read from its cache,
 * and a write fails fast through the transport guard instead of waiting in a queue.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            networkMode: "offlineFirst",
            retry: (failureCount, error) => {
              // Offline, a retry cannot succeed and would leave the view pending.
              if (!navigator.onLine) return false;
              // A 4xx will not succeed on retry; only transient failures are worth one.
              const status = (error as { status?: number }).status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false, networkMode: "offlineFirst" },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineStatus />
      {/* The undo stack lives above every route, so the toast survives the navigation a
          compensating command may cause (spec 10.3). Shortcuts nest inside it, because
          the palette's undo command dispatches through the stack (GAP-10). */}
      <UndoProvider>
        <ShortcutsProvider>{children}</ShortcutsProvider>
      </UndoProvider>
    </QueryClientProvider>
  );
}
