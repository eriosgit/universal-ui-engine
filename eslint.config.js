// @ts-check
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", "fixtures/**/*.html"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // Regla del núcleo (§2 del plan): core no puede ramificar por identidad de backend.
          // Complementa la regla de dependency-cruiser (que bloquea el import de paquetes
          // backend-*) atrapando además comparaciones directas contra un literal 'backend'.
          selector:
            "BinaryExpression[operator=/^(===|==|!==|!=)$/][left.property.name='backend']",
          message:
            "core no debe ramificar por identidad de backend (node.backend === '...'). Usa node.supports (Verb) — ver ADR-0002.",
        },
      ],
    },
  },
];
