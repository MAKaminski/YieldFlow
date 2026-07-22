import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isFlagEnabled } from "@/lib/flags";

export const metadata: Metadata = {
  title: "YieldFlow — Deposit-Bonus Harvesting Agent",
  description:
    "Discovers bank sign-up bonuses, models their requirements, and ranks them by bonus dollars per capital-day.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The Business tab only renders when the feature flag is on (default off).
  const businessEnabled = await isFlagEnabled("business_accounts").catch(() => false);
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <header className="border-b border-edge/60 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-semibold tracking-tight">
                Yield<span className="text-accent">Flow</span>
              </span>
              <span className="rounded bg-edge/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mute">
                advisory
              </span>
            </Link>
            <nav className="flex gap-6 text-sm text-mute">
              <Link href="/" className="hover:text-slate-100">
                Offers
              </Link>
              {businessEnabled && (
                <Link href="/business" className="hover:text-slate-100">
                  Business
                </Link>
              )}
              <Link href="/campaigns" className="hover:text-slate-100">
                Campaigns
              </Link>
              <Link href="/vault" className="hover:text-slate-100">
                My details
              </Link>
              <Link href="/admin" className="hover:text-slate-100">
                Admin
              </Link>
              <a href="/api/offers" className="hover:text-slate-100">
                API
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs text-mute">
          YieldFlow never takes custody of funds — advisory + assisted execution only.
        </footer>
      </body>
    </html>
  );
}
