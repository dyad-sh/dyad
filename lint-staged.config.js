module.exports = {
  "**/*.{ts,tsx}": () => "npm run ts",
  "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,astro,svelte}": "oxlint",
  "*.{js,css,md,ts,tsx,jsx,json,yml,yaml}": "oxfmt",
};
