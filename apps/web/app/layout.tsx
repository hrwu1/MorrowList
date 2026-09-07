import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";

import "./globals.css";
import "./studio.css";

/** Application shell (FND-007). */

export const metadata: Metadata = {
  title: { default: "MorrowList", template: "%s · MorrowList" },
  description:
    "One canonical task model, shown as a list, a plan for today, or a board.",
  // The task list is private; search engines must never index a signed-in view.
  robots: { index: false, follow: false },
  // Installable as an app (spec 25.1). The manifest is a static file so the worker can
  // precache it; the Apple fields cover Safari, which reads the manifest only partially.
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "MorrowList", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#19221e" },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        {/* Keyboard users must be able to bypass the navigation (spec 14). */}
        <a className="ml-skip-link" href="#main">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
