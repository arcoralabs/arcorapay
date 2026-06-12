import type { SVGProps } from "react";
import { useId } from "react";

/**
 * Arcora "A" symbol — current brand mark. Matches the canonical SVG at
 * `public/brand/arcora-logo.svg` (June 2026 edit: no settlement dot).
 * The mark is 4 paths: blue A + white counter triangle + teal swoosh +
 * white "smile arc" stroke. Gradient ids are scoped via useId() so multiple
 * instances don't collide.
 */
export function ArcoraSymbol({
  size = 32, title = "Arcorapay", ...rest
}: { size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const gBlue = `${uid}-blue`;
  const gTeal = `${uid}-teal`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="48 43 321 306"
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      {...rest}
    >
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient id={gBlue} x1="0.5414" y1="-0.2276" x2="1.2444" y2="0.6276">
          <stop offset="0" stopColor="#2563FF" />
          <stop offset="1" stopColor="#165DFF" />
        </linearGradient>
        <linearGradient id={gTeal} x1="0.1305" y1="0" x2="0.7023" y2="-1.1237">
          <stop offset="0" stopColor="#00C2A8" />
          <stop offset="1" stopColor="#21D4E6" />
        </linearGradient>
      </defs>
      <g transform="translate(90 54)">
        <path
          d="M119.999 7.483 C113.994 -2.494 99.983 -2.494 93.978 7.483 L1.901 191.06 C-4.104 203.032 4.903 217 17.914 217 L65.954 217 C72.96 217 78.965 213.009 81.968 207.023 L119.999 127.207 L158.031 207.023 C161.033 213.009 167.038 217 174.044 217 L224.086 217 C237.097 217 246.104 203.032 240.099 191.06 L119.999 7.483 Z"
          fill={`url(#${gBlue})`}
        />
      </g>
      <g transform="translate(172 129)">
        <path
          d="M29.263 3.75 L1.263 63.75 C-2.737 71.75 3.263 80.75 12.263 80.75 L56.263 80.75 C65.263 80.75 71.263 71.75 67.263 63.75 L39.263 3.75 C37.263 -1.25 31.263 -1.25 29.263 3.75 Z"
          fill="#ffffff"
          fillOpacity="0.98"
        />
      </g>
      <g transform="translate(59 204)">
        <path
          d="M63.147 72.276 C97.633 25.096 141.819 0 196.781 0 C231.268 0 258.21 8.031 285.153 24.092 C294.852 30.115 297.008 43.165 289.464 51.195 L262.521 81.31 C256.055 88.337 244.2 90.345 235.579 85.326 C220.491 77.295 202.17 72.276 180.616 72.276 C138.586 72.276 101.944 90.345 73.924 126.483 C67.457 134.513 54.525 136.521 45.903 130.498 L8.184 104.398 C-1.516 97.372 -2.593 84.322 4.951 75.287 C21.116 55.211 38.359 37.142 57.758 22.084 C68.535 14.054 83.623 21.08 83.623 34.13 L83.623 53.203 C83.623 60.23 79.312 67.257 73.924 72.276 L63.147 72.276 Z"
          fill={`url(#${gTeal})`}
        />
      </g>
      <g transform="translate(128 199)">
        <path
          d="M-4.943 67.779 C-7.274 70.508 -6.951 74.611 -4.221 76.943 C-1.492 79.274 2.611 78.951 4.943 76.221 L0 72 L-4.943 67.779 Z M151.481 0.483 L152.139 -5.983 L152.053 -5.992 L151.966 -5.999 L151.481 0.483 Z M222.135 34.316 C225.022 36.451 229.092 35.841 231.226 32.955 C233.361 30.068 232.751 25.998 229.865 23.864 L226 29.09 L222.135 34.316 Z M0 72 L4.943 76.221 C47.901 25.924 96.099 2.863 150.997 6.965 L151.481 0.483 L151.966 -5.999 C92.031 -10.478 40.056 15.092 -4.943 67.779 L0 72 Z M151.481 0.483 L150.823 6.95 C177.809 9.697 199.902 17.875 222.135 34.316 L226 29.09 L229.865 23.864 C205.677 5.977 181.348 -3.009 152.139 -5.983 L151.481 0.483 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="miter"
          fillRule="nonzero"
        />
      </g>
    </svg>
  );
}

interface ArcoraLogoProps {
  size?: number;
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
}

/**
 * Full lockup: symbol + two-tone "Arcorapay" wordmark, optional tagline.
 * Use `showTagline` in hero / footer surfaces; leave it off in headers.
 */
export function ArcoraLogo({
  size = 32,
  showWordmark = true,
  showTagline = false,
  className,
}: ArcoraLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {/* When the wordmark is visible it carries the accessible name; hide the symbol from AT to avoid a double announcement */}
      <ArcoraSymbol size={size} aria-hidden={showWordmark || undefined} />
      {showWordmark && (
        <span className="inline-flex flex-col leading-none">
          <span
            className="font-[family-name:var(--font-display)] font-bold text-[var(--fg-1)]"
            style={{ fontSize: size * 0.7, letterSpacing: "-0.03em" }}
          >
            Arcora<span style={{ color: "var(--sage)" }}>pay</span>
          </span>
          {showTagline && (
            <span
              className="font-[family-name:var(--font-mono)] uppercase text-[var(--fg-3)] mt-1"
              style={{ fontSize: size * 0.22, letterSpacing: "0.18em" }}
            >
              Stablecoin checkout &amp; settlement
            </span>
          )}
        </span>
      )}
    </span>
  );
}
