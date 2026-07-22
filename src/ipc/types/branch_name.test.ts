import { describe, expect, it } from "vitest";
import { safeBranchNameSchema } from "./branch_name";

describe("safeBranchNameSchema", () => {
  it("accepts ordinary branch names", () => {
    for (const branch of [
      "main",
      "feature/my-branch",
      "release-1.2.3",
      "user@host",
      "fix_underscores",
    ]) {
      expect(safeBranchNameSchema.safeParse(branch).success).toBe(true);
    }
  });

  it("rejects empty strings and leading dashes", () => {
    expect(safeBranchNameSchema.safeParse("").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("-b").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("--force").success).toBe(false);
  });

  it("rejects full refs and revision expressions", () => {
    for (const value of [
      "refs/tags/v1",
      "refs/heads/main",
      "main..dev",
      "main~1",
      "main^",
      "origin:main",
    ]) {
      expect(safeBranchNameSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects the bare dot and relative-path pathspecs that would discard working-tree changes", () => {
    // `git checkout .` (or `./`, `../`) is interpreted as a pathspec and
    // silently discards unstaged changes; these must never reach `gitCheckout`
    // as a ref.
    expect(safeBranchNameSchema.safeParse(".").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("..").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("./").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("./src").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("../").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("../etc").success).toBe(false);
    // A dot inside an otherwise valid branch name is still fine.
    expect(safeBranchNameSchema.safeParse("release-1.2.3").success).toBe(true);
  });

  it("rejects reflog expressions", () => {
    expect(safeBranchNameSchema.safeParse("main@{1}").success).toBe(false);
    expect(safeBranchNameSchema.safeParse("@{-1}").success).toBe(false);
  });

  it("rejects characters forbidden by git check-ref-format", () => {
    for (const value of [
      "my branch",
      "branch\\name",
      "branch?",
      "branch*",
      "branch[1]",
      "branch\x00name",
      "branch\x1fname",
      "branch\x7fname",
    ]) {
      expect(safeBranchNameSchema.safeParse(value).success).toBe(false);
    }
  });
});
