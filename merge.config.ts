export default {
  testDir: "e2e-tests",
  reporter: [
    ["html", { open: "never" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
};
