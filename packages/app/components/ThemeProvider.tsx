"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="arcora-theme"
      disableTransitionOnChange
      // CSP nonce for the inline no-FOUC theme bootstrap script (audit MED-5):
      // without it the script is blocked under the nonce-based script-src.
      nonce={nonce}
    >
      {children}
    </NextThemeProvider>
  );
}
