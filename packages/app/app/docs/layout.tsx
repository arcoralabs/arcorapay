import { SiteFooter } from "@/components/landing/SiteFooter";
import type { ReactNode } from "react";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
