import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cart";
import { ShopHeader } from "@/components/ShopHeader";
import { ShopFooter } from "@/components/ShopFooter";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const interDisplay = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});
const jetMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Arcora Shop · Stablecoin checkout dogfooding",
  description: "Caps, tees, mugs and stickers — paid in USDC or EURC, settled on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interDisplay.variable} ${jetMono.variable}`}>
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <CartProvider>
          <ShopHeader />
          <div className="flex-1">{children}</div>
          <ShopFooter />
        </CartProvider>
      </body>
    </html>
  );
}
