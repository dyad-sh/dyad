import { describe, expect, it } from "vitest";
import { buildOpenRouterFreeModels } from "@/ipc/shared/openrouter_free_models";

describe("buildOpenRouterFreeModels", () => {
  it("filters to free models and decorates display names", () => {
    const models = [
      {
        id: "paid/model",
        name: "Paid Model",
        pricing: { prompt: "0.01", completion: "0.02" },
      },
      {
        id: "free/model",
        name: "Awesome Model",
        pricing: { prompt: "0", completion: "0" },
        context_length: 128_000,
      },
      {
        id: "free/with-label",
        name: "Free Model",
        pricing: { prompt: 0, completion: 0, image: 0 },
      },
    ];

    const result = buildOpenRouterFreeModels(models);

    expect(result).toHaveLength(2);
    const awesome = result.find((model) => model.apiName === "free/model");
    expect(awesome?.displayName).toBe("Awesome Model");
    expect(awesome?.contextWindow).toBe(128_000);
    expect(awesome?.tag).toBe("Free");

    const labeled = result.find((model) => model.apiName === "free/with-label");
    expect(labeled?.displayName).toBe("Free Model");
    expect(labeled?.dollarSigns).toBe(0);
  });
});
