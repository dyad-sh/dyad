import assert from "node:assert/strict";
import test from "node:test";

import {
  composeComment,
  composeFallbackComment,
  normalizeTriage,
  sanitizeText,
  SIGN_OFF,
} from "./triage-comment.mjs";

const context = {
  issueNumber: 4456,
  repository: "dyad-sh/dyad",
  author: "reporter",
  releases: ["1.13.0", "1.13.0-beta.1", "1.12.0"],
};

const baseTriage = {
  labels: ["bug"],
  assessment: "environment_setup",
  summary: "Dyad can't find Node.js on your computer.",
  steps: [],
  filedFromApp: true,
};

test("sanitizeText strips HTML, foreign mentions, and disallowed links", () => {
  const input =
    "Hi <b>@reporter</b>, ping @wwwillchen and see https://evil.example/x and https://www.dyad.sh/download. Also [docs](https://example.com/docs) and [notes](https://www.dyad.sh/docs/releases/1.13.0) cc support@dyad.sh";
  const output = sanitizeText(input, {
    author: "reporter",
    repository: "dyad-sh/dyad",
  });
  assert.equal(
    output,
    "Hi @reporter, ping wwwillchen and see [link removed] and https://www.dyad.sh/download. Also docs and [notes](https://www.dyad.sh/docs/releases/1.13.0) cc support@dyad.sh",
  );
});

test("sanitizeText only allows github links inside this repository", () => {
  const output = sanitizeText(
    "See https://github.com/dyad-sh/dyad/issues/1 and https://github.com/other/repo/issues/2",
    { repository: "dyad-sh/dyad" },
  );
  assert.equal(
    output,
    "See https://github.com/dyad-sh/dyad/issues/1 and [link removed]",
  );
});

test("sanitizeText keeps newlines only in multiline mode and enforces length", () => {
  assert.equal(
    sanitizeText("a\n\n\n\nb  \n c", { multiline: true }),
    "a\n\nb\n c",
  );
  assert.equal(sanitizeText("a\n\n\n\nb  \n c"), "a b c");
  assert.equal(sanitizeText("abcdef", { maxLength: 3 }), "abc");
});

test("normalizeTriage rejects malformed decisions", () => {
  const cases = [
    [{ ...baseTriage, assessment: "vibes" }, /Invalid assessment/],
    [{ ...baseTriage, summary: "" }, /summary is required/],
    [{ ...baseTriage, labels: ["bug", "feature request"] }, /Exactly one/],
    [{ ...baseTriage, labels: ["bug", "wontfix"] }, /Invalid label/],
    [{ ...baseTriage, assessment: "fixed_in_release" }, /requires fixedIn/],
    [
      { ...baseTriage, fixedIn: { version: "9.9.9" } },
      /not a published release/,
    ],
    [{ ...baseTriage, fixedIn: { version: "latest" } }, /not a version/],
    [
      { ...baseTriage, related: [{ number: 4456, outcome: "open" }] },
      /must not reference the current issue/,
    ],
    [
      { ...baseTriage, related: [{ number: 1, outcome: "maybe" }] },
      /outcome is invalid/,
    ],
    [{ ...baseTriage, infoNeeded: ["phone"] }, /Invalid infoNeeded/],
    [{ ...baseTriage, nonEnglish: true }, /requires issue\/lang/],
    [{ triageFailed: true, reason: "no output" }, /Agent reported failure/],
  ];
  for (const [raw, pattern] of cases) {
    assert.throws(() => normalizeTriage(raw, context), pattern);
  }
});

test("normalizeTriage accepts a version-shaped fixedIn when releases are unknown", () => {
  const triage = normalizeTriage(
    {
      ...baseTriage,
      assessment: "fixed_in_release",
      fixedIn: { version: "v1.13.0" },
    },
    { ...context, releases: null },
  );
  assert.deepEqual(triage.fixedIn, {
    version: "1.13.0",
    url: "https://www.dyad.sh/docs/releases/1.13.0",
  });
});

test("normalizeTriage caps lists, dedupes, and derives needsHuman", () => {
  const triage = normalizeTriage(
    {
      ...baseTriage,
      assessment: "needs_human",
      steps: ["one", "two", "three", "four", "five"],
      related: [
        { number: 1, outcome: "open" },
        { number: 2, outcome: "fixed", note: "fixed in 1.12.0" },
        { number: 3, outcome: "open" },
      ],
      possiblyRelated: [{ number: 4, note: "same area" }],
      infoNeeded: ["session_id", "session_id", "screenshot"],
      developerNotes: "- line one\n- line two\n\n\n\n- line three",
      playbookMatch: "credits-billing",
    },
    context,
  );
  assert.equal(triage.needsHuman, true);
  assert.equal(triage.steps.length, 4);
  assert.deepEqual(
    triage.related.map((entry) => entry.number),
    [1, 2],
  );
  assert.deepEqual(triage.infoNeeded, ["session_id", "screenshot"]);
  assert.equal(triage.developerNotes, "- line one\n- line two\n\n- line three");
  assert.equal(triage.playbookMatch, "credits-billing");
});

test("composeComment renders every section for a full decision", () => {
  const triage = normalizeTriage(
    {
      ...baseTriage,
      steps: [
        "Install Node.js from https://nodejs.org (pick the LTS version).",
        "Quit Dyad completely and open it again.",
      ],
      related: [
        { number: 3665, outcome: "resolved_with_workaround" },
        { number: 3348, outcome: "open" },
      ],
      possiblyRelated: [{ number: 3612, note: "corrupted PATH entry" }],
      infoNeeded: ["screenshot_not_attached"],
      developerNotes: "- Log: 'node' is not recognized",
      playbookMatch: "node-not-found-windows",
    },
    context,
  );
  const comment = composeComment(triage, { author: "reporter" });
  assert.equal(
    comment,
    [
      "Hi @reporter, thanks for sending this from Dyad.",
      "",
      "**What's going on:** Dyad can't find Node.js on your computer.",
      "",
      "**What you can do now:**",
      "1. Install Node.js from https://nodejs.org (pick the LTS version).",
      "2. Quit Dyad completely and open it again.",
      "",
      "**Others with the same problem:** #3665 (the steps above resolved it there) · #3348 (still open, you can follow it for updates)",
      "",
      "**To help us fix it:** It looks like your screenshot didn't come through. Could you paste it here?",
      "",
      SIGN_OFF,
      "",
      "<details>",
      "<summary>Notes for the Dyad team</summary>",
      "",
      "- Log: 'node' is not recognized",
      "- Assessment: environment_setup · Playbook: node-not-found-windows",
      "- Possibly related: #3612 (corrupted PATH entry)",
      "</details>",
    ].join("\n"),
  );
});

test("composeComment adds an update step when a release fixed it", () => {
  const triage = normalizeTriage(
    {
      ...baseTriage,
      filedFromApp: false,
      assessment: "fixed_in_release",
      summary: "This crash was fixed recently.",
      fixedIn: { version: "1.13.0" },
      steps: ["Open a new chat after updating."],
    },
    context,
  );
  const comment = composeComment(triage, { author: "reporter" });
  assert.match(comment, /^Hi @reporter, thanks for the report\./);
  assert.match(
    comment,
    /1\. Update to Dyad 1\.13\.0 or newer from https:\/\/www\.dyad\.sh\/download, which includes the fix \(\[release notes\]\(https:\/\/www\.dyad\.sh\/docs\/releases\/1\.13\.0\)\)\.\n2\. Open a new chat after updating\./,
  );
  assert.match(comment, /Playbook: no match/);
});

test("composeComment inlines a single step and the English-only note", () => {
  const triage = normalizeTriage(
    {
      ...baseTriage,
      labels: ["bug", "issue/lang"],
      nonEnglish: true,
      assessment: "needs_info",
      summary: "We can't tell yet what went wrong.",
      infoNeeded: ["description", "screenshot"],
    },
    context,
  );
  const comment = composeComment(triage, { author: "reporter" });
  assert.match(comment, /We can only respond in English\./);
  assert.match(
    comment,
    /\*\*To help us fix it:\*\* Reply with what you were doing and what you saw instead\. A screenshot of the error is the fastest way for us to help\./,
  );
  assert.doesNotMatch(comment, /What you can do now/);
});

test("composeComment stays quiet on feature requests without a route", () => {
  const triage = normalizeTriage(
    { labels: ["feature request"], assessment: "feature_request" },
    context,
  );
  assert.equal(composeComment(triage, { author: "reporter" }), null);
});

test("composeComment offers the existing route on feature requests", () => {
  const triage = normalizeTriage(
    {
      labels: ["feature request"],
      assessment: "feature_request",
      steps: [
        "You can add it today as a custom model: https://www.dyad.sh/docs/guides/ai-models/custom-models",
      ],
      developerNotes: "- Third provider request this month.",
      playbookMatch: "model-missing-or-new-provider",
    },
    context,
  );
  const comment = composeComment(triage, { author: "reporter" });
  assert.match(
    comment,
    /^Hi @reporter, thanks for the suggestion\. We've logged it as a feature request\.\n\n\*\*In the meantime:\*\* You can add it today/,
  );
  assert.doesNotMatch(comment, new RegExp(SIGN_OFF));
  assert.match(comment, /Notes for the Dyad team/);
});

test("composeComment groups related reports that share an outcome", () => {
  const triage = normalizeTriage(
    {
      ...baseTriage,
      related: [
        { number: 3665, outcome: "resolved_with_workaround" },
        { number: 3348, outcome: "resolved_with_workaround" },
      ],
    },
    context,
  );
  assert.match(
    composeComment(triage, { author: "reporter" }),
    /\*\*Others with the same problem:\*\* #3665 and #3348 \(the steps above resolved it there\)/,
  );
});

test("composeFallbackComment greets the reporter", () => {
  assert.equal(
    composeFallbackComment({ author: "reporter" }),
    "Hi @reporter, thanks for the report. Our automatic first look didn't complete, so someone from the Dyad team will take a look directly.",
  );
});
