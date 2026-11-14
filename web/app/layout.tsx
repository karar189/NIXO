import type { Metadata } from "next";
import { Geist, Geist_Mono, Michroma, Space_Grotesk } from "next/font/google";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const michroma = Michroma({ variable: "--font-michroma", subsets: ["latin"], weight: "400" });
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "NIXO: private trading, provably clean money",
  description:
    "Private AI trading agents on NEAR. Every deposit is checked inside a secure enclave against hack and sanctions lists; exchanges see only a Clean or Rejected certificate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${michroma.variable} ${grotesk.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
