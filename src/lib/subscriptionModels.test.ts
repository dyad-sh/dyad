import { describe, expect, it } from "vitest";
import {
  CHATGPT_PLAN_LABELS,
  getSubscriptionDefaultModel,
  normalizeChatGPTPlanType,
} from "./subscriptionModels";

const current = { provider: "openai", name: "gpt-5.6-terra" };
const catalog = ["gpt-5.6-luna", current.name];
describe("subscription defaults", () => {
  it.each([undefined, "free", "go", "business", "enterprise", "edu"])(
    "prefers Luna for %s plans even with an eligible current selection",
    (plan) => {
      expect(
        getSubscriptionDefaultModel(
          [current.name, "gpt-5.6-luna"],
          plan,
          current,
        ),
      ).toBe("gpt-5.6-luna");
      expect(getSubscriptionDefaultModel([current.name], plan, current)).toBe(
        current.name,
      );
    },
  );
  it.each(["plus", "pro"])("preserves a supported selection for %s", (plan) => {
    expect(getSubscriptionDefaultModel(catalog, plan, current)).toBe(
      current.name,
    );
    expect(
      getSubscriptionDefaultModel(catalog, plan, {
        provider: "auto",
        name: "auto",
      }),
    ).toBe(catalog[0]);
  });
  it("does not invent a model when the catalog is empty", () => {
    expect(getSubscriptionDefaultModel([], "free", current)).toBeUndefined();
  });
  it("normalizes known plan values without treating unknown metadata as a paid plan", () => {
    expect(normalizeChatGPTPlanType("Plus")).toBe("plus");
    expect(normalizeChatGPTPlanType("new-tier")).toBeUndefined();
    expect(normalizeChatGPTPlanType(null)).toBeUndefined();
  });
  it.each([
    "business",
    "self_serve_business_prolite",
    "self_serve_business_usage_based",
    "SELF_SERVE_BUSINESS_PROLITE",
    "SELF_SERVE_BUSINESS_USAGE_BASED",
  ])("displays %s as Business", (value) => {
    const plan = normalizeChatGPTPlanType(value);
    expect(plan).toBe("business");
    expect(plan && CHATGPT_PLAN_LABELS[plan]).toBe("Business");
  });
  it("does not classify unrecognized Business variants as Business", () => {
    expect(
      normalizeChatGPTPlanType("self_serve_business_unknown"),
    ).toBeUndefined();
  });
});
