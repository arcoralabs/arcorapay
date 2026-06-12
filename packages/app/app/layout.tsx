import type { Metadata } from "next";
import { headers } from "next/headers";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ChainProviders } from "@/lib/chain/wagmi-config";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Arcorapay",
  description: "Stablecoin checkout & settlement on Arc",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce set by middleware (audit MED-5). Reading headers()
  // opts every route into dynamic rendering — required for nonce-based CSP,
  // since a prerendered page would ship inline scripts without the
  // per-request nonce and they would be blocked.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${hanken.variable} ${plexMono.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider nonce={nonce}>
          <ChainProviders>{children}</ChainProviders>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
