"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { arcTestnet } from "@/lib/chain/wagmi-config";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const NAV_ITEMS = [
  { id: "overview",   label: "Overview",   href: "/m/dashboard",  icon: "M3 12L12 3l9 9M5 10v10h14V10" },
  { id: "treasury",   label: "Treasury",   href: "/m/treasury",   icon: "M4 7h16v12H4zM4 11h16M9 15h2" },
  { id: "compliance", label: "Compliance", href: "/m/compliance", icon: "M12 2L4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4z" },
  { id: "settings",   label: "Settings",   href: "/m/settings",   icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM19 12l2 1-2 1M5 12l-2 1 2 1M12 5l1-2 1 2M12 19l1 2 1-2" },
] as const;

// Audit #28 extension: derive from the canonical chain definition rather
// than hardcoding 5042002 with an env-var escape hatch. When mainnet ships,
// arcTestnet → arcMainnet here ripples everywhere. Widened to `number` so
// the comparison stays meaningful once the source becomes a union.
const ARC_CHAIN_ID: number = arcTestnet.id;
const IS_TESTNET = ARC_CHAIN_ID !== 1;

interface Props {
  merchantAddress: string;
}

export function MerchantSidebar({ merchantAddress }: Props) {
  const pathname = usePathname() ?? "";
  const initials = merchantAddress.slice(2, 4).toUpperCase();
  const shortAddr = `${merchantAddress.slice(0, 6)}…${merchantAddress.slice(-4)}`;

  return (
    <aside className="hidden md:flex flex-col w-[244px] shrink-0 px-4 py-[22px] gap-1 bg-[var(--surface-2)] border-r border-[var(--border)] min-h-screen sticky top-0 self-start">
      <Link href={"/m/dashboard" as Route} aria-label="Arcorapay home" className="px-2.5 pb-3 inline-flex">
        <ArcoraLogo size={26} />
      </Link>

      <div className="px-2.5 pb-3.5 flex flex-col gap-1.5">
        <span className="eyebrow">Merchant</span>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] bg-[var(--acc-soft)] border border-[var(--acc-line)] text-[color-mix(in_oklch,var(--acc)_80%,var(--fg-1))] flex items-center justify-center mono font-bold text-[12px]">
            {initials}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-[var(--fg-1)] truncate">{shortAddr}</span>
            <span className="mono text-[10.5px] text-[var(--fg-3)]">arc · {IS_TESTNET ? "testnet" : "live"}</span>
          </div>
        </div>
      </div>

      <div className="divider my-2 -mx-4" />

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.id}
              href={item.href as Route}
              className={`m-navitem ${active ? "on" : ""}`}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-3 flex flex-col gap-2">
        {IS_TESTNET && (
          <div className="field p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="dot" />
              <span className="mono text-[10px] text-[var(--fg-3)] tracking-[.1em]">ARC TESTNET</span>
            </div>
            <p className="text-[11.5px] text-[var(--fg-2)] leading-snug m-0">
              You&apos;re on testnet. Switch network to go live.
            </p>
          </div>
        )}
        <div className="px-2.5 flex items-center justify-between">
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="m-link inline-flex items-center gap-1.5 text-[12px]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
