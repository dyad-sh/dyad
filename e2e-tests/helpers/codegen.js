/*
 * From: https://github.com/microsoft/playwright/issues/5181#issuecomment-2769098576
 *
 * Usage:
 * cd e2e-tests/helpers && node codegen.js
 */

const { _electron: electron } = require("playwright");

(async () => {
  const browser = await electron.launch({
    args: [
      "../../out/dyad-darwin-arm64/dyad.app/Contents/Resources/app.asar/.vite/build/main.js",
      "--enable-logging",
      "--user-data-dir=/tmp/dyad-e2e-tests",
    ],
    executablePath: "../../out/dyad-darwin-arm64/dyad.app/Contents/MacOS/dyad",
  });
  const context = await browser.context();
  await context.route("**/*", (route) => route.continue());

  await require("node:timers/promises").setTimeout(3000); // wait for the window to load
  await browser.windows()[0].pause(); // .pause() opens the Playwright-Inspector for manual recording
})();
