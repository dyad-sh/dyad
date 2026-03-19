import { describe, expect, it } from "vitest";
import { getWritePlanUiState } from "@/components/chat/DyadWritePlan";

describe("getWritePlanUiState", () => {
  it("shows generating badge when plan is still in progress and no plan data exists", () => {
    const result = getWritePlanUiState({
      isInProgress: true,
      hasPlan: false,
    });

    expect(result.showViewPlanButton).toBe(false);
    expect(result.showGeneratingBadge).toBe(true);
  });

  it("shows View Plan when plan data exists even if complete=false", () => {
    const result = getWritePlanUiState({
      isInProgress: false,
      hasPlan: true,
    });

    expect(result.showViewPlanButton).toBe(true);
    expect(result.showGeneratingBadge).toBe(false);
  });

  it("shows View Plan when plan is finished and plan data exists", () => {
    const result = getWritePlanUiState({
      isInProgress: false,
      hasPlan: true,
    });

    expect(result.showViewPlanButton).toBe(true);
    expect(result.showGeneratingBadge).toBe(false);
  });

  it("shows neither badge nor button when finished without plan data", () => {
    const result = getWritePlanUiState({
      isInProgress: false,
      hasPlan: false,
    });

    expect(result.showViewPlanButton).toBe(false);
    expect(result.showGeneratingBadge).toBe(false);
  });

  it("keeps generating state while in progress even if previous plan exists", () => {
    const result = getWritePlanUiState({
      isInProgress: true,
      hasPlan: false,
    });

    expect(result.showViewPlanButton).toBe(false);
    expect(result.showGeneratingBadge).toBe(true);
  });
});
