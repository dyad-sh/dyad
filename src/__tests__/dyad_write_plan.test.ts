import { describe, expect, it } from "vitest";
import {
  getWritePlanUiState,
  shouldLoadPersistedPlan,
} from "@/components/chat/DyadWritePlan";

describe("getWritePlanUiState", () => {
  it("shows generating badge when plan is in progress and no plan exists", () => {
    const result = getWritePlanUiState({
      isInProgress: true,
      hasPlan: false,
    });

    expect(result.showViewPlanButton).toBe(false);
    expect(result.showGeneratingBadge).toBe(true);
  });

  it("shows View Plan when plan is not in progress and plan exists", () => {
    const result = getWritePlanUiState({
      isInProgress: false,
      hasPlan: true,
    });

    expect(result.showViewPlanButton).toBe(true);
    expect(result.showGeneratingBadge).toBe(false);
  });

  it("shows neither badge nor button when plan is not in progress and no plan exists", () => {
    const result = getWritePlanUiState({
      isInProgress: false,
      hasPlan: false,
    });

    expect(result.showViewPlanButton).toBe(false);
    expect(result.showGeneratingBadge).toBe(false);
  });

  it("returns helper-consistent values when both flags are true", () => {
    const result = getWritePlanUiState({
      isInProgress: true,
      hasPlan: true,
    });

    expect(result.showViewPlanButton).toBe(true);
    expect(result.showGeneratingBadge).toBe(false);
  });
});

describe("shouldLoadPersistedPlan", () => {
  it("returns true when plan is no longer in progress", () => {
    expect(
      shouldLoadPersistedPlan({
        isInProgress: false,
      }),
    ).toBe(true);
  });

  it("returns false while a plan is still in progress", () => {
    expect(
      shouldLoadPersistedPlan({
        isInProgress: true,
      }),
    ).toBe(false);
  });
});
