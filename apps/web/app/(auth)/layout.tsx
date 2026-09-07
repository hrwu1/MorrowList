import type { ReactNode } from "react";

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main" className="auth-shell">
      <aside className="studio-welcome" aria-label="Welcome to MorrowList">
        <div className="studio-welcome__brand">morrowlist</div>
        <div className="studio-welcome__body">
          <p className="studio-eyebrow">A little clarity goes a long way</p>
          <h2>
            Big ideas. <br />
            Small steps. <br />
            <em>Room to breathe.</em>
          </h2>
          <p>
            A quieter place for everything on your mind.
            <br />
            Find your next step, and make it count.
          </p>
        </div>
        <svg
          className="studio-welcome__art"
          viewBox="0 0 400 280"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="200" cy="126" r="76" />
          <path d="M200 17V0M200 252v28M91 126H60M340 126h-31M123 49l-20-20M277 49l20-20M123 203l-20 20M277 203l20 20M0 215c80-35 124-35 200 0s124 35 200 0M0 240c80-35 124-35 200 0s124 35 200 0" />
        </svg>
        <span className="studio-welcome__footer">Less managing. More living.</span>
      </aside>
      <div className="studio-auth-content">{children}</div>
    </main>
  );
}
