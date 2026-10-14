import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Hard boundary between the two product domains:
//   - "expenses": inbound invoice intake / vendors / dashboards
//   - "generator": outbound invoice creation / customers / templates / public REST API
// They may only meet through the shared shell (mode switcher, layout) and shared
// libs under src/lib, src/components/{ui,shared,shell}, src/auth.ts, src/db.
// See AGENTS.md for the rationale.

const expensesPatterns = [
  "@/features/expenses",
  "@/features/expenses/*",
  "@/features/expenses/**",
];

const generatorPatterns = [
  "@/features/generator",
  "@/features/generator/*",
  "@/features/generator/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/features/expenses/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: generatorPatterns.map((p) => ({
            group: [p],
            message:
              "Expenses code must not import from the invoice-generator domain. They share only src/lib, src/db, src/components/{ui,shared,shell}, and the shell switch view.",
          })),
        },
      ],
    },
  },
  {
    files: ["src/features/generator/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: expensesPatterns.map((p) => ({
            group: [p],
            message:
              "Generator code must not import from the expenses domain. They share only src/lib, src/db, src/components/{ui,shared,shell}, and the shell switch view.",
          })),
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "mobile/**",
    // Vendored agent skills (expo/skills, pinned in skills-lock.json). Their
    // CommonJS helper scripts are third-party code that a skill update
    // overwrites, so they are not ours to lint.
    ".agents/**",
  ]),
]);

export default eslintConfig;
