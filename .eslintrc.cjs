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
    react: {
      version: "detect"
    }
  },
  ignorePatterns: ["node_modules", "dist", ".next", "out"],
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
