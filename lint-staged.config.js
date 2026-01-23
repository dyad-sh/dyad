const fs = require("fs");
const { resolve } = require("path");

module.exports = {
  "**/*.{ts,tsx}": () => "npm run ts",
  "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,astro,svelte}": "oxlint",
  "*.{js,css,md,ts,tsx,jsx,json,yml,yaml}": (filenames) => {
    // Filter out symlinks
    const realFiles = filenames.filter((file) => {
      try {
        const stats = fs.lstatSync(resolve(file));
        return !stats.isSymbolicLink();
      } catch {
        return false;
      }
    });

    if (realFiles.length === 0) return [];
    return `prettier --write ${realFiles.join(" ")}`;
  },
};
