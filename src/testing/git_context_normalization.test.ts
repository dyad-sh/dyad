import { describe, expect, it } from "vitest";

import { normalizeGitContextHashes } from "../../e2e-tests/helpers/utils/normalization";

describe("Git context snapshot normalization", () => {
  it("normalizes final and source hashes recursively and idempotently", () => {
    const dump = {
      body: {
        input: [
          '<dyad-git-context commit="0123456789abcdef0123456789abcdef01234567"></dyad-git-context>',
          {
            text: '<dyad-git-context source_commit="abcdef0123456789abcdef0123456789abcdef01" no_commit="true"></dyad-git-context>',
          },
        ],
      },
    };

    normalizeGitContextHashes(dump);
    const once = structuredClone(dump);
    normalizeGitContextHashes(dump);

    expect(dump).toEqual(once);
    expect(dump.body.input).toEqual([
      '<dyad-git-context commit="[[GIT_COMMIT]]"></dyad-git-context>',
      {
        text: '<dyad-git-context source_commit="[[GIT_COMMIT]]" no_commit="true"></dyad-git-context>',
      },
    ]);
  });
});
