import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NIXO",
  description: "Prove your money is clean without proving where it's been.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-3xl items-center gap-6 px-4 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              NIXO
            </Link>
            <Link href="/" className="text-sm text-muted hover:text-foreground">
              Prove funds
            </Link>
            <Link href="/verify" className="text-sm text-muted hover:text-foreground">
              Verify (exchange)
            </Link>
            <span className="ml-auto rounded-full bg-mock-bg px-2 py-0.5 text-xs text-mock">testnet</span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
