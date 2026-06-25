import { describe, expect, it } from "vitest";
import { getDyadGenerateTestTags } from "./dyad_tag_parser";

describe("getDyadGenerateTestTags", () => {
  it("parses a single generate-test tag", () => {
    const response = `Sure, here's a test:
<dyad-generate-test path="tests/signup.spec.ts" description="Tests signup">
import { test, expect } from "@playwright/test";
test("signup", async ({ page }) => {
  await page.goto("/");
});
</dyad-generate-test>`;
    const tags = getDyadGenerateTestTags(response);
    expect(tags).toHaveLength(1);
    expect(tags[0].path).toBe("tests/signup.spec.ts");
    expect(tags[0].description).toBe("Tests signup");
    expect(tags[0].content).toContain("@playwright/test");
  });

  it("strips markdown code fences", () => {
    const response = `<dyad-generate-test path="tests/a.spec.ts">
\`\`\`ts
const x = 1;
\`\`\`
</dyad-generate-test>`;
    const [tag] = getDyadGenerateTestTags(response);
    expect(tag.content).toBe("const x = 1;");
  });

  it("ignores tags without a path", () => {
    const response = `<dyad-generate-test description="no path">x</dyad-generate-test>`;
    expect(getDyadGenerateTestTags(response)).toHaveLength(0);
  });

  it("does not match plain dyad-write tags", () => {
    const response = `<dyad-write path="src/App.tsx">code</dyad-write>`;
    expect(getDyadGenerateTestTags(response)).toHaveLength(0);
  });
});
