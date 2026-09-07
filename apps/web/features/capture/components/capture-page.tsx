"use client";
import { Alert, Button, Field, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { SharedCapture } from "../lib/share";
import { sharedTaskRequest } from "../lib/share";

import { useOnline } from "@/features/offline/hooks/use-online";
import { useCaptureNames, useParsingEnabled } from "@/features/tasks/hooks/use-capture";
import { useCreateTask } from "@/features/tasks/hooks/use-tasks";
import {
  captureFields,
  capturePreview,
  parseQuickAdd,
} from "@/features/tasks/lib/capture";

export function CapturePage({ shared }: { readonly shared: SharedCapture }) {
  const initial = sharedTaskRequest(shared);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) inputRef.current?.focus();
  }, [ready]);
  const [title, setTitle] = useState(
    shared.title || shared.text || shared.url ? initial.title : "",
  );
  const create = useCreateTask();
  const router = useRouter();
  const names = useCaptureNames();
  const parsing = useParsingEnabled();
  const online = useOnline();
  const parsed = parseQuickAdd(title, names.today, [], []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || create.isPending || !online) return;
    try {
      const task = await create.mutateAsync({
        ...initial,
        title: parsing ? parsed.title : title,
        ...(parsing ? captureFields(parsed) : {}),
      });
      if (window.opener) window.close();
      router.replace(`/tasks/${task.key}`);
    } catch {
      /* Mutation error is rendered with the original draft intact. */
    }
  }
  return (
    <main id="main" className="settings-page capture-page stack">
      <header className="page-header">
        <h1>Quick capture</h1>
        <p className="page-header__subtitle">One thought, straight into your Inbox.</p>
      </header>
      <form
        className="settings-form stack"
        aria-label="Capture a task"
        onSubmit={submit}
      >
        <Field
          label="Task"
          htmlFor="capture-title"
          hint="Try Call Sam tomorrow 5pm. A backslash keeps a word literal."
        >
          <TextInput
            ref={inputRef}
            disabled={!ready}
            id="capture-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            autoFocus
            aria-describedby="capture-preview"
          />
        </Field>
        <p id="capture-preview" aria-live="polite">
          {parsing ? capturePreview(parsed) : title}
        </p>
        {initial.descriptionMd ? (
          <p
            className="page-header__subtitle"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {initial.descriptionMd}
          </p>
        ) : null}
        {!online ? (
          <Alert tone="warning">
            You are offline. Keep this page open and submit when connected.
          </Alert>
        ) : null}
        {create.isError ? <Alert tone="error">{create.error.message}</Alert> : null}
        <Button type="submit" disabled={!title.trim() || create.isPending || !online}>
          {create.isPending ? "Adding…" : "Add to Inbox"}
        </Button>
      </form>
      <Link href="/inbox">Back to Inbox</Link>
    </main>
  );
}
