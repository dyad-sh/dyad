import { describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  addFileToSupabaseDeployPayloadBudget,
  createSupabaseDeployPayloadBudget,
  MAX_SUPABASE_DEPLOY_FILES,
} from "./supabase_deploy_limits";

describe("Supabase deploy payload limits", () => {
  it("stops file discovery at the file-count quota", () => {
    const budget = createSupabaseDeployPayloadBudget("test function");
    for (let index = 0; index < MAX_SUPABASE_DEPLOY_FILES; index++) {
      addFileToSupabaseDeployPayloadBudget(budget, `file-${index}.ts`, 0);
    }

    expect(() =>
      addFileToSupabaseDeployPayloadBudget(budget, "one-too-many.ts", 0),
    ).toThrow(
      expect.objectContaining({
        kind: DyadErrorKind.Validation,
        message: expect.stringContaining("more than"),
      }),
    );
  });
});
