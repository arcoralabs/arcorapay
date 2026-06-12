import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "test/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./test/setup.ts"],
    environmentMatchGlobs: [
      ["components/**/*.tsx", "happy-dom"],
      ["components/**/*.test.tsx", "happy-dom"],
      ["app/**/*.tsx", "happy-dom"],
      ["**/*.test.tsx", "happy-dom"],
      ["**/*.test.ts", "node"],
    ],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
