import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
