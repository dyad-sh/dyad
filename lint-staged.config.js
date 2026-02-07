module.exports = {
  "**/*.{ts,tsx}": () => "npm run ts",
  "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,astro,svelte}": "oxlint",
  "*": "oxfmt --no-error-on-unmatched-pattern",
};
