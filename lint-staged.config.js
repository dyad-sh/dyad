module.exports = {
  "**/*.{ts,tsx}": () => "pnpm run ts",
  "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,astro,svelte}": "oxlint",
  "*": "oxfmt --no-error-on-unmatched-pattern",
};
