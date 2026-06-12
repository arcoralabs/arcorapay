import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ArcoraLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export interface DocsNavItem {
  href: string;
  label: string;
}

export interface DocsNavGroup {
  title: string;
  items: DocsNavItem[];
}

export const DOCS_NAV: DocsNavGroup[] = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Introduction" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/sdk", label: "SDK" },
      { href: "/docs/rest-api", label: "REST API" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/tokens", label: "Token reference" },
      { href: "/docs/errors", label: "Errors" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/docs/deployment", label: "Self-host" },
      { href: "/docs/compliance", label: "Compliance" },
      { href: "/docs/migration", label: "Migration · v0.9 → v0.10" },
    ],
  },
];

export function DocsShell({
  title,
  description,
  children,
  currentPath,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  currentPath: string;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="topbar">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href={"/" as Route} className="inline-flex items-center" aria-label="Arcora home">
            <ArcoraLogo size={26} />
          </Link>
          <nav className="flex items-center gap-4 sm:gap-5">
            <Link href={"/" as Route} className="navlink">Home</Link>
            <Link href={"/quickstart" as Route} className="navlink hidden md:inline-block">Tester</Link>
            <Link href={"/m/login" as Route} className="navlink whitespace-nowrap">Merchants</Link>
            <a href="https://github.com/arcoralabs/arcorapay" className="navlink">GitHub</a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Mobile/tablet docs nav: horizontal scrolling chips. Hidden on lg+
           where the sticky sidebar takes over. */}
      <nav
        aria-label="Docs navigation"
        className="lg:hidden border-b overflow-x-auto"
      >
        <ul className="flex items-center gap-1 px-4 sm:px-6 py-3 whitespace-nowrap text-sm">
          {DOCS_NAV.flatMap((g) => g.items).map((item) => {
            const active = currentPath === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href as Route}
                  className={`block rounded-full px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-[var(--acc-soft)] text-[color-mix(in_oklch,var(--acc)_75%,var(--fg-1))] font-semibold"
                      : "text-muted-foreground hover:bg-[var(--surface-3)] hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8 lg:gap-12 pt-8 pb-16">
        <aside className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
          <nav className="space-y-7 text-sm">
            {DOCS_NAV.map((group) => (
              <div key={group.title}>
                <h4 className="eyebrow mb-2">
                  {group.title}
                </h4>
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const active = currentPath === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href as Route}
                          className={`block rounded-md px-2 py-1.5 transition-colors ${
                            active
                              ? "bg-[var(--acc-soft)] text-[color-mix(in_oklch,var(--acc)_75%,var(--fg-1))] font-semibold"
                              : "text-muted-foreground hover:bg-[var(--surface-3)] hover:text-foreground"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <header className="mb-8">
            <h1 className="disp" style={{ fontSize: "clamp(34px, 4vw, 44px)" }}>
              {title}
            </h1>
            {description && (
              <p className="lead mt-3 text-lg max-w-2xl">{description}</p>
            )}
          </header>
          <Prose>{children}</Prose>
        </main>
      </div>
    </div>
  );
}

/** Typography-styled wrapper. Tailwind v4 group-selectors keep this tidy without the typography plugin. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      className={`
        max-w-3xl
        text-foreground text-[15px] leading-[1.7]
        [&_p]:mb-4 [&_p]:text-[15px] [&_p]:leading-[1.7] [&_p]:text-[var(--fg-2)]
        [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:text-[26px] [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h2]:font-[family-name:var(--font-display)]
        [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-[20px] [&_h3]:font-semibold [&_h3]:text-foreground
        [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-[16px] [&_h4]:font-semibold [&_h4]:text-foreground
        [&_ul]:mb-4 [&_ul]:pl-5 [&_ul]:list-disc [&_ul>li]:mb-1.5 [&_ul>li]:text-[var(--fg-2)]
        [&_ol]:mb-4 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol>li]:mb-1.5
        [&_a]:text-[var(--action)] [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-[var(--action-hover)]
        [&_code]:font-[family-name:var(--font-mono)] [&_code]:text-[13px] [&_code]:bg-[var(--surface-3)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
        [&_pre]:bg-[var(--bg-sunken)] [&_pre]:border [&_pre]:text-[var(--fg-2)] [&_pre]:rounded-2xl [&_pre]:p-5 [&_pre]:overflow-x-auto [&_pre]:my-5 [&_pre]:text-[13px] [&_pre]:leading-[1.6]
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[var(--fg-2)] [&_pre_code]:text-[13px]
        [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm
        [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:border-b [&_th]:font-semibold [&_th]:text-foreground [&_th]:bg-[var(--surface-2)]
        [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-[var(--border-faint)] [&_td]:align-top
        [&_blockquote]:my-5 [&_blockquote]:pl-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--acc-line)] [&_blockquote]:text-muted-foreground [&_blockquote]:italic
        [&_strong]:font-semibold [&_strong]:text-foreground
        [&_hr]:my-10
      `}
    >
      {children}
    </div>
  );
}
