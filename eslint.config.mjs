import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  { ignores: ["node_modules/**", "tests/**", ".cache/**", ".runtime-tests/**", "dist/**", "main.js", "scripts/**", "docs/**"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
  },
];
