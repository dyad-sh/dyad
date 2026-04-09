import { describe, expect, it } from "vitest";
import { isNextJsProject } from "./framework_constants";

describe("isNextJsProject", () => {
  it("detects Next.js projects from next.config.cjs", () => {
    expect(
      isNextJsProject({
        files: ["src/app/page.tsx", "next.config.cjs"],
      }),
    ).toBe(true);
  });
});
