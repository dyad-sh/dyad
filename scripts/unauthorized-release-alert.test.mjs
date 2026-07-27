import assert from "node:assert/strict";
import test from "node:test";

import {
  createReleaseAlert,
  parseRecipients,
} from "./unauthorized-release-alert.mjs";

const baseAlert = {
  repository: "dyad-sh/dyad",
  releaseId: "123",
  releaseTag: "v9.9.9",
  releaseAuthor: "octocat",
  deleteResult: "success",
  releaseName: "Unexpected release",
  createdAt: "2026-07-27T12:00:00Z",
  publishedAt: "2026-07-27T12:05:00Z",
  runUrl: "https://github.com/dyad-sh/dyad/actions/runs/456",
};

test("parseRecipients trims, deduplicates, and removes empty entries", () => {
  assert.deepEqual(
    parseRecipients("one@example.com, two@example.com,one@example.com, "),
    ["one@example.com", "two@example.com"],
  );
});

test("parseRecipients rejects an empty recipient list", () => {
  assert.throws(
    () => parseRecipients(" , "),
    /must contain at least one email address/,
  );
});

test("createReleaseAlert reports successful deletion without tag deletion", () => {
  const alert = createReleaseAlert(baseAlert);

  assert.match(alert.subject, /^\[ALERT\]/);
  assert.match(alert.text, /was deleted automatically/);
  assert.match(alert.text, /Git tag was not deleted/);
});

test("createReleaseAlert makes deletion failures urgent and escapes HTML", () => {
  const alert = createReleaseAlert({
    ...baseAlert,
    deleteResult: "failure",
    releaseName: "<script>alert('release')</script>",
  });

  assert.match(alert.subject, /^\[URGENT\]/);
  assert.match(alert.text, /Automatic deletion did not succeed/);
  assert.doesNotMatch(alert.html, /<script>/);
  assert.match(
    alert.html,
    /&lt;script&gt;alert\(&#39;release&#39;\)&lt;\/script&gt;/,
  );
});
