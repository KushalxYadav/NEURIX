import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Private study material and pipeline output (extracted archives contain third-party JS).
    "data/**",
    "source-material/**",
    "tests/e2e/.fixture-data/**",
    ".venv/**",
  ]),
]);

export default eslintConfig;
