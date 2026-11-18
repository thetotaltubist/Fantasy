import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Fantasy HQ", description: "Your leagues, start-sit help, waivers and trades." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b line" style={{ background: "var(--card)" }}>
          <div className="mx-auto max-w-5xl px-4 h-12 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg tracking-tight">
              Fantasy<span style={{ color: "var(--brand)" }}>HQ</span>
            </Link>
            <nav className="text-sm muted flex gap-5">
              <Link href="/">My leagues</Link>
              <Link href="/espn">ESPN settings</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
