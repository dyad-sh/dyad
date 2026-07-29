import { describe, expect, it } from "vitest";

import { COMPACTION_SYSTEM_PROMPT } from "./compaction_system_prompt";

describe("COMPACTION_SYSTEM_PROMPT", () => {
  it("preserves standing user preferences across compaction", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain(
      "## Standing Preferences & Constraints",
    );
    expect(COMPACTION_SYSTEM_PROMPT).toContain(
      "A preference or constraint stated once, early, still binds",
    );
  });
});
