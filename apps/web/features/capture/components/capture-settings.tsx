"use client";
import { Alert, Button, Field, Spinner, TextInput } from "@morrowlist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { captureBookmarklet } from "../lib/share";

import { useDefaultWorkspace } from "@/features/workspace/hooks/use-workspace";
import { apiClient } from "@/lib/api-client";

export function CaptureSettings() {
  const workspace = useDefaultWorkspace();
  const client = useQueryClient();
  const [bookmarklet, setBookmarklet] = useState("");
  const [copied, setCopied] = useState("");
  const key = ["capture-address", workspace?.id] as const;
  const address = useQuery({
    queryKey: key,
    enabled: Boolean(workspace),
    staleTime: 0,
    gcTime: 0,
    queryFn: () => apiClient.getInboundAddress({ workspaceId: workspace!.id }),
  });
  const rotate = useMutation({
    mutationFn: () => apiClient.rotateInboundAddress({ workspaceId: workspace!.id }),
    onSuccess: (value) => {
      client.setQueryData(key, value);
      setCopied("Address updated. Previous addresses no longer accept email.");
    },
  });
  useEffect(() => {
    setBookmarklet(captureBookmarklet(window.location.origin));
  }, []);
  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(message);
    } catch {
      setCopied("Copy was unavailable. Select and copy the text manually.");
    }
  }
  return (
    <section className="settings-form stack" aria-labelledby="capture-channels-heading">
      <h2 id="capture-channels-heading">Capture from anywhere</h2>
      <p>
        Use <Link href="/capture">Quick capture</Link> or press Ctrl/⌘ Shift Space while
        the app is focused.
      </p>
      <h3>Email to Inbox</h3>
      {address.isPending ? (
        <Spinner label="Loading capture address" />
      ) : address.isError ? (
        <Alert tone="error">
          Could not load your capture address.{" "}
          <Button onClick={() => void address.refetch()}>Try again</Button>
        </Alert>
      ) : !address.data.enabled ? (
        <p>
          Email capture is not configured on this server. Your administrator can enable
          a receiving domain and authenticated email delivery.
        </p>
      ) : (
        <>
          <p>
            Anyone with this secret address can send tasks to your Inbox. Rotate it if
            it has been shared unintentionally.
          </p>
          {address.data.address ? (
            <>
              <Field label="Your capture email address" htmlFor="capture-address">
                <TextInput id="capture-address" readOnly value={address.data.address} />
              </Field>
              <Button
                onClick={() => void copy(address.data.address!, "Address copied.")}
              >
                Copy address
              </Button>
            </>
          ) : (
            <p>Create an address to start capturing emails.</p>
          )}
          <Button disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            {rotate.isPending
              ? "Updating…"
              : address.data.address
                ? "Rotate address"
                : "Create capture address"}
          </Button>
        </>
      )}
      {rotate.isError ? <Alert tone="error">{rotate.error.message}</Alert> : null}
      <h3>Browser bookmarklet</h3>
      <p>
        Create a bookmark named “Capture to MorrowList”, then paste this code into its
        URL. Open it on a page to capture its title and link.
      </p>
      <Field label="Bookmarklet code" htmlFor="capture-bookmarklet">
        <TextInput id="capture-bookmarklet" readOnly value={bookmarklet} />
      </Field>
      <Button
        onClick={() => void copy(bookmarklet, "Bookmarklet copied.")}
        disabled={!bookmarklet}
      >
        Copy bookmarklet
      </Button>
      <p role="status">{copied}</p>
    </section>
  );
}
