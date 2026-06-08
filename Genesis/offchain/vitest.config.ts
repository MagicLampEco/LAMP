import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tái dùng Treasury offchain SDK trực tiếp từ source (KHÔNG cần build dist).
      // Genesis import schema custody + seed_value_ok của Treasury, KHÔNG copy.
      "@magiclamp/treasury-sdk": resolve(__dirname, "../../Treasury/offchain/src/index.ts"),
    },
  },
  test: {
    include: ["../tests/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
  },
});
