import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [
      ".github/**",
      "**/*.md",
      "evals/**",
      "research/**",
      "skills/**",
      "verification/**",
    ],
  },
  test: {
    include: ["tooling/tests/**/*.test.ts"],
  },
});
