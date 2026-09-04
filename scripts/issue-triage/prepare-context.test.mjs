import assert from "node:assert/strict";
import test from "node:test";

import {
  formatReleaseIndex,
  formatServiceStatus,
  parseReleaseList,
} from "./prepare-context.mjs";

test("parseReleaseList drops drafts and strips the v prefix", () => {
  const releases = parseReleaseList([
    {
      tagName: "v1.14.0-beta.1",
      publishedAt: "2026-09-03T23:45:27Z",
      isDraft: true,
      isPrerelease: true,
    },
    {
      tagName: "v1.13.0",
      publishedAt: "2026-08-31T20:47:21Z",
      isDraft: false,
      isPrerelease: false,
    },
    {
      tagName: "v1.13.0-beta.1",
      publishedAt: "2026-08-28T19:53:34Z",
      isDraft: false,
      isPrerelease: true,
    },
  ]);
  assert.deepEqual(releases, [
    {
      tag: "v1.13.0",
      version: "1.13.0",
      publishedAt: "2026-08-31",
      prerelease: false,
    },
    {
      tag: "v1.13.0-beta.1",
      version: "1.13.0-beta.1",
      publishedAt: "2026-08-28",
      prerelease: true,
    },
  ]);
});

test("formatReleaseIndex renders one line per release", () => {
  assert.equal(
    formatReleaseIndex([
      { version: "1.13.0", publishedAt: "2026-08-31", prerelease: false },
      { version: "1.13.0-beta.1", publishedAt: "2026-08-28", prerelease: true },
    ]),
    "1.13.0 (stable, 2026-08-31)\n1.13.0-beta.1 (beta, 2026-08-28)",
  );
  assert.equal(formatReleaseIndex([]), "(release list unavailable)");
});

test("formatServiceStatus renders one line per service", () => {
  assert.equal(
    formatServiceStatus({
      GitHub: "All Systems Operational",
      Supabase: "Partial System Outage",
    }),
    "GitHub: All Systems Operational\nSupabase: Partial System Outage",
  );
  assert.equal(formatServiceStatus({}), "(not checked)");
});
