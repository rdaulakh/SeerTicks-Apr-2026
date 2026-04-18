import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "server/**/*.ts",
      ],
      exclude: [
        "server/**/*.test.ts",
        "server/**/*.spec.ts",
        "server/**/__tests__/**",
        "server/_core/**",
        "server/tests/**",
        "node_modules/**",
        "dist/**",
        "coverage/**",
      ],
      // Baseline (Feb 2026, post Phase 17): stmts 30.05%, branches 70.91%, functions 48.56%
      // Note: Line/statement coverage is low because most server code (100K+ lines of trading
      // engines, agents, services) is exercised by integration tests that are skipped in unit mode.
      // Integration tests (INTEGRATION_TEST=1) cover the remaining code paths.
      // Thresholds are set 1-2% below baseline to prevent regressions while allowing fluctuation.
      // Target: Incrementally raise to 50%+ as more unit tests are added.
      thresholds: {
        lines: 29,
        functions: 47,
        branches: 69,
        statements: 29,
      },
    },
  },
});
