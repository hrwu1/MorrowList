"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

const LINKS = [
  { href: "/inbox", label: "Inbox" },
] as const;

/**
 * Primary navigation (spec 7.2). Only the views this slice implements are listed; adding
 * Today, Upcoming, and Projects is a matter of extending this array once those land.
 */
export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="app-nav">
      <div className="app-nav__brand">MorrowList</div>

      <nav aria-label="Primary">
        <ul className="app-nav__list">
          {LINKS.map((link) => {
            const current = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="app-nav__link"
                  // Communicates the current view to assistive technology (spec 14).
                  aria-current={current ? "page" : undefined}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        type="button"
        className="ml-button ml-button--ghost"
        onClick={async () => {
          await authClient.signOut();
          router.push("/sign-in");
          router.refresh();
        }}
      >
        Sign out
      </button>
    </header>
  );
}
