import type { NextConfig } from "next";

// Audit M14 (2026-05-06): security headers for the shop storefront.
// Mirrors packages/app/lib/security/headers.ts — kept inline here since the
// shop is a separate Next.js app without access to the app package's lib.
function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options",          value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options",   value: "nosniff" },
    { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https:",
        "frame-ancestors 'self'",
      ].join("; "),
    },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}

const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
};

export default config;
