import { defineConfig } from "tsup";

// Two builds in one tsup config:
//   1. The npm surface — ESM + CJS. src/index.ts is the root export;
//      src/webhook.ts is the `@arcora/sdk/webhook` subpath (node:crypto —
//      kept out of the root bundle so browser consumers never pull it in).
//   2. The CDN surface — IIFE from src/cdn.ts that flattens the API so a
//      <script src="…"> integrator can write `Arcora.init(…)` directly.
export default defineConfig([
  {
    entry: ["src/index.ts", "src/webhook.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: true,
    // Keep the canonical `node:crypto` specifier in the built output —
    // tsup strips the node: prefix by default (legacy Node compat), which
    // Deno and edge runtimes with Node compat don't resolve.
    removeNodeProtocol: false,
  },
  {
    entry: { "arcora": "src/cdn.ts" },
    format: ["iife"],
    globalName: "Arcora",
    dts: false,
    sourcemap: true,
    clean: false,         // don't wipe the index.* outputs from build #1
    treeshake: true,
    minify: true,
    outExtension: () => ({ js: ".global.js" }),
  },
]);
