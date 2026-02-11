module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "next/core-web-vitals"
  ],
  settings: {
    next: {
      // Monorepo: Next app lives under apps/web
      rootDir: ["apps/web/"]
    },
    react: {
      version: "detect"
    }
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/node_modules.bak/**",
    "**/dist/**",
    "**/.next/**",
    "**/out/**",
    "packages/contracts/artifacts/**",
    "packages/contracts/cache/**",
    "packages/contracts/typechain-types/**"
  ],
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx"],
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly"
      }
    }
  ]
};
