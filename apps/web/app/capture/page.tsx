import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CapturePage } from "@/features/capture/components/capture-page";
import { capturePath, readSharedCapture } from "@/features/capture/lib/share";
import { getContainer } from "@/lib/server";

export const metadata = {
  title: "Quick capture",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let shared;
  try {
    shared = readSharedCapture({ get: (name) => params[name] });
  } catch {
    return (
      <main id="main" className="settings-page capture-page">
        <h1>Unable to capture this share</h1>
        <p>Use a shorter title or text and an http or https URL.</p>
      </main>
    );
  }
  const user = await getContainer().auth.resolveUser(new Headers(await headers()));
  if (!user) {
    let returnTo: string;
    try {
      returnTo = capturePath(shared);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return (
        <main id="main" className="settings-page capture-page stack">
          <h1>Share needs a shorter selection</h1>
          <p>{error.message}</p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {[shared.title, shared.text, shared.url].filter(Boolean).join("\n\n")}
          </p>
          <a href="/capture">Open Quick capture</a>
        </main>
      );
    }
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return <CapturePage shared={shared} />;
}
