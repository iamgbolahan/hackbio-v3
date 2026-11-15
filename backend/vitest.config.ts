import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Node resolves this nested folder directly; Vite would treat "generated" as the package name.
    alias: {
      "generated/prisma/client": resolve(
        __dirname,
        "node_modules/generated/prisma/client.js",
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://hackbio:hackbio@localhost:55440/hackbio_test",
      CORS_ORIGINS: "http://localhost:5500",
      PERSISTENCE_RESP_RATE_MIN: "30",
      PERSISTENCE_SPO2_MIN: "30",
      PERSISTENCE_SBP_MIN: "60",
      PERSISTENCE_GLUCOSE_MIN: "",
      BASELINE_Z_LIMIT: "",
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
  },
});
