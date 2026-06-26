import { describe, expect, it } from "vitest";
import {
  isFreeProBuildModeCombination,
  isFreeProLanguageModel,
  isFreeProModel,
} from "./freeProModel";

describe("freeProModel", () => {
  it("identifies the Dyad Free model", () => {
    expect(isFreeProModel({ provider: "auto", name: "free-pro" })).toBe(true);
    expect(isFreeProLanguageModel("auto", "free-pro")).toBe(true);
    expect(isFreeProModel({ provider: "auto", name: "auto" })).toBe(false);
  });

  it("blocks only Dyad Free with Build mode", () => {
    expect(
      isFreeProBuildModeCombination(
        { provider: "auto", name: "free-pro" },
        "build",
      ),
    ).toBe(true);
    expect(
      isFreeProBuildModeCombination(
        { provider: "auto", name: "free-pro" },
        "local-agent",
      ),
    ).toBe(false);
    expect(
      isFreeProBuildModeCombination(
        { provider: "auto", name: "auto" },
        "build",
      ),
    ).toBe(false);
  });
});
