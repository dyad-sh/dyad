import { describe, expect, it } from "vitest";
import { truncateGithubOpsErrorMessage } from "./error_message";

describe("truncateGithubOpsErrorMessage", () => {
  it("never exceeds a bound shorter than the truncation notice", () => {
    expect(truncateGithubOpsErrorMessage("long message", 5)).toHaveLength(5);
    expect(truncateGithubOpsErrorMessage("long message", 0)).toBe("");
  });
});
