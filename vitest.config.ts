import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
    globalSetup: ["tests/globalSetup.ts"],
    env: { DATABASE_URL: "postgres://fl:fl@localhost:5433/fishing_law_test" },
  },
});
