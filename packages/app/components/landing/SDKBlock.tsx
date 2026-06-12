"use client";

import { useState, type ReactNode } from "react";

/**
 * "Four lines, first settlement" — port of the design's SDK code block. Pure
 * marketing visual, no live data; the snippet uses real `@arcora/sdk` exports
 * so a developer reading it can paste-run it. Syntax colors come from the
 * `.code-pane` / `.tok-*` recipes in globals.css.
 */

const CODE = `import { Arcora } from '@arcora/sdk';

const arcora = new Arcora({ apiKey: process.env.ARCORA_KEY });

// Create an invoice — customer pays EURC, you settle in your payout stable
const invoice = await arcora.createInvoice({
  amountUsdc: 49.00,
  payInToken: 'EURC',
  successUrl: 'https://shop.example.com/ok',
  metadata: { orderId: 'ord_8124' },
});

return Response.redirect(invoice.url);`;

const KEYWORDS  = new Set(["import", "from", "const", "await", "return", "new", "process", "env"]);
const TYPENAMES = new Set(["Arcora", "Response"]);

/**
 * Tokenize a single line into colored React spans. Replaces the original
 * dangerouslySetInnerHTML approach so static analysis stays quiet. Grammar is
 * deliberately tiny — the input is one hard-coded snippet.
 */
function highlightLine(line: string, keyPrefix: string): ReactNode[] {
  if (line.length === 0) return [<span key={keyPrefix}>&nbsp;</span>];

  // Match priority: comment → string → number → identifier-followed-by-paren → identifier → other.
  const re = /(\/\/.*$)|('[^']*')|(\b\d[\d_.]*\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\()|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;

  const out: ReactNode[] = [];
  let i = 0;
  for (const m of line.matchAll(re)) {
    const [, comment, str, num, methodIdent, ident, other] = m;
    let node: ReactNode;
    if (comment !== undefined) {
      node = <span className="tok-com">{comment}</span>;
    } else if (str !== undefined) {
      node = <span className="tok-str">{str}</span>;
    } else if (num !== undefined) {
      node = <span className="tok-num">{num}</span>;
    } else if (methodIdent !== undefined) {
      node = <span className={KEYWORDS.has(methodIdent) ? "tok-kw" : "tok-fn"}>{methodIdent}</span>;
    } else if (ident !== undefined) {
      node = KEYWORDS.has(ident)
        ? <span className="tok-kw">{ident}</span>
        : TYPENAMES.has(ident)
          ? <span className="tok-fn">{ident}</span>
          : ident;
    } else {
      node = other;
    }
    out.push(<span key={keyPrefix + ":" + i++}>{node}</span>);
  }
  return out;
}

export function SDKBlock() {
  const [copied, setCopied] = useState(false);
  const lines = CODE.split("\n");

  const copy = () => {
    void navigator.clipboard?.writeText(CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="sdk-grid grid items-center" style={{ gridTemplateColumns: "0.85fr 1.15fr", gap: 56 }}>
      <div>
        <p className="eyebrow eyebrow--acc mb-4">Developers</p>
        <h2 className="disp mb-5" style={{ fontSize: "clamp(36px, 4.6vw, 54px)" }}>
          Four lines.<br /><em>First settlement.</em>
        </h2>
        <p className="lead mb-6 max-w-[440px] text-[16px]">
          Drop in the npm SDK, point a webhook at your worker, and you&apos;re collecting stablecoin volume.
          TypeScript-first, framework-agnostic, batteries included.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <a
            href="https://www.npmjs.com/package/@arcora/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="pill pill--ghost pill--sm"
          >
            <span className="mono" style={{ color: "var(--fg-3)" }}>$</span>
            npm install @arcora/sdk
          </a>
          <a
            href="https://github.com/arcoralabs/arcorapay/tree/HEAD/packages/sdk#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="pill pill--ghost pill--sm"
          >
            Read the docs
          </a>
        </div>
      </div>

      <div className="card overflow-hidden p-0" style={{ boxShadow: "var(--elev-3)" }}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5" style={{ background: "var(--surface-3)" }}>
          <div className="flex gap-[7px]" aria-hidden="true">
            {["#ff5f57", "#febc2e", "#28c840"].map(c => (
              <span key={c} className="h-[11px] w-[11px] rounded-full opacity-85" style={{ background: c }} />
            ))}
          </div>
          <span className="mono text-[11px]" style={{ color: "var(--fg-3)" }}>routes/checkout.ts</span>
          <div className="flex items-center gap-2.5">
            <span className="mono text-[11px]" style={{ color: "var(--fg-3)" }}>TS</span>
            <button
              type="button"
              onClick={copy}
              className="iconbtn"
              style={{ width: 30, height: 30, borderRadius: 9 }}
              aria-label={copied ? "Copied" : "Copy code"}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="code-pane" style={{ border: "none", borderRadius: 0 }}>
          <pre className="m-0 overflow-auto px-5 py-4">
            {lines.map((l, idx) => (
              <div key={idx} className="flex gap-4">
                <span className="ln mono w-5 shrink-0 select-none text-right text-[12.5px] tabular-nums">{idx + 1}</span>
                <span className="mono text-[12.5px] leading-[1.75]">{highlightLine(l, String(idx))}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
