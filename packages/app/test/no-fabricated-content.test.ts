import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN: Array<[label: string, re: RegExp]> = [
  ["Stripe comparison", /\bStripe\b/i],
  ["Trusted-by wall", /trusted by/i],
  ["fake SOC2 badge", /\bSOC2\b/i],
  ["fake TRM badge", /TRM\s*SCREENED/i],
  ["fake verified-merchant badge", /verified merchant/i],
  ["fake company Lumen", /\bLumen\b/i],
  ["fake company Northbound", /\bNorthbound\b/i],
  ["fake company Vela Studio", /vela[\s/]*studio/i],
  ["fake company Cobalt", /\bCobalt\b/i],
  ["fake company Meridian", /\bMeridian\b/i],
  ["fake company Hexa", /\bHexa\b/i],
  ["fake fill metric", /fill\s*99\.97/i],
];

const SELF = "no-fabricated-content.test.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(SELF)) out.push(p);
  }
  return out;
}

const files = ["app", "components"].flatMap((r) => walk(join(process.cwd(), r)));

describe("no fabricated content in shipped UI", () => {
  for (const file of files) {
    it(`${file.split("/packages/app/")[1] ?? file} is clean`, () => {
      const text = readFileSync(file, "utf8");
      for (const [label, re] of FORBIDDEN) {
        expect(re.test(text), `${file} contains ${label}`).toBe(false);
      }
    });
  }
});
