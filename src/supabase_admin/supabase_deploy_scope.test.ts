import { describe, expect, it } from "vitest";
import {
  describeSupabaseDeployScope,
  formatSupabaseDeployScopeTitleSuffix,
} from "./supabase_deploy_scope";

describe("formatSupabaseDeployScopeTitleSuffix", () => {
  it("names the fallback reason so it is visible in a collapsed card", () => {
    expect(
      formatSupabaseDeployScopeTitleSuffix({
        kind: "all",
        reason: {
          code: "unresolved_relative_import",
          filePath: "supabase/functions/alpha/index.ts",
          specifier: "../_shared/missing.ts",
        },
      }),
    ).toBe(" (fallback to all functions: unresolved import)");
  });

  it("adds nothing for targeted deploys", () => {
    expect(
      formatSupabaseDeployScopeTitleSuffix({
        kind: "edited",
        functionNames: ["alpha"],
      }),
    ).toBe("");
    expect(formatSupabaseDeployScopeTitleSuffix(undefined)).toBe("");
  });
});

describe("describeSupabaseDeployScope", () => {
  it("explains an unresolved import with the importing file", () => {
    expect(
      describeSupabaseDeployScope({
        kind: "all",
        reason: {
          code: "unresolved_relative_import",
          filePath: "supabase/functions/alpha/index.ts",
          specifier: "../_shared/missing.ts",
        },
      }),
    ).toBe(
      'Redeployed all functions because dependency analysis couldn\'t resolve "../_shared/missing.ts" imported from supabase/functions/alpha/index.ts.',
    );
  });

  it("includes analysis failure details without doubling punctuation", () => {
    expect(
      describeSupabaseDeployScope({
        kind: "all",
        reason: {
          code: "dependency_analysis_failed",
          detail:
            "Supabase dependency analysis ran out of memory. This can happen with very large apps.",
        },
      }),
    ).toBe(
      "Redeployed all functions because dependency analysis failed: Supabase dependency analysis ran out of memory. This can happen with very large apps.",
    );
  });

  it("lists the shared-module trigger and dependent functions for targeted deploys", () => {
    expect(
      describeSupabaseDeployScope({
        kind: "affected",
        changedSharedModulePaths: ["supabase/functions/_shared/cors.ts"],
        affectedFunctionNames: ["alpha"],
        editedFunctionNames: ["alpha", "beta"],
      }),
    ).toBe(
      [
        "Changed shared modules: supabase/functions/_shared/cors.ts",
        "Functions that depend on them: alpha",
        "Functions edited directly: beta",
      ].join("\n"),
    );
  });

  it("says when no functions depend on the changed shared modules", () => {
    expect(
      describeSupabaseDeployScope({
        kind: "affected",
        changedSharedModulePaths: ["supabase/functions/_shared/unused.ts"],
        affectedFunctionNames: [],
        editedFunctionNames: [],
      }),
    ).toBe(
      [
        "Changed shared modules: supabase/functions/_shared/unused.ts",
        "Functions that depend on them: none",
      ].join("\n"),
    );
  });
});
