// Opt-in video recording for the CUJ suites.
//
// The suites create browser contexts directly (multi-persona flows), so
// Playwright's `use.video` config option does not apply to them. Passing these
// options into every `browser.newContext(...)` call makes a recording run
// possible without changing scoring behavior: with CUJ_VIDEO_DIR unset (every
// scoring run) this returns {} and nothing changes.
export function videoOpts(): Record<string, unknown> {
  const dir = process.env.CUJ_VIDEO_DIR;
  if (!dir) return {};
  return {
    recordVideo: { dir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  };
}
