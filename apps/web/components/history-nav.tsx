"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Completed and Trash are recovery-oriented views of one global task history. */
export function HistoryNav() {
  const pathname = usePathname();

  return (
    <div className="history-nav">
      <div>
        <p className="history-nav__eyebrow">Workspace</p>
        <span className="history-nav__title">History</span>
      </div>
      <nav aria-label="History views">
        <Link
          href="/completed"
          aria-current={pathname === "/completed" ? "page" : undefined}
        >
          Completed
        </Link>
        <Link href="/trash" aria-current={pathname === "/trash" ? "page" : undefined}>
          Trash
        </Link>
      </nav>
    </div>
  );
}
