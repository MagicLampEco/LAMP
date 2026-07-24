import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Test sống một cấp trên package.json (PlatformKit/tests/), cùng mẫu Treasury.
    include: ["../tests/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
  },
});
