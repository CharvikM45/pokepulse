import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/collector/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "packages/contracts/src/**/*.ts",
        "packages/domain/src/**/*.ts",
        "apps/web/src/**/*.ts",
        "services/**/*.ts",
      ],
      exclude: ["**/index.ts", "**/types.ts"],
    },
  },
});
