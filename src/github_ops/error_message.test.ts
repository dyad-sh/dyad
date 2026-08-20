import { describe, expect, it } from "vitest";
import {
  isDetailedGithubOpsErrorMessage,
  truncateGithubOpsErrorMessage,
} from "./error_message";

describe("truncateGithubOpsErrorMessage", () => {
  it("never exceeds a bound shorter than the truncation notice", () => {
    expect(truncateGithubOpsErrorMessage("long message", 5)).toHaveLength(5);
    expect(truncateGithubOpsErrorMessage("long message", 0)).toBe("");
  });
});

describe("isDetailedGithubOpsErrorMessage", () => {
  it("classifies multiline and long errors as detailed", () => {
    expect(isDetailedGithubOpsErrorMessage("first\nsecond")).toBe(true);
    expect(isDetailedGithubOpsErrorMessage("x".repeat(241))).toBe(true);
    expect(isDetailedGithubOpsErrorMessage("x".repeat(240))).toBe(false);
  });
});
