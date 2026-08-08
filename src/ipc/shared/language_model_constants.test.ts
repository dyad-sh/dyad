import { describe, expect, it } from "vitest";
import {
  CLOUD_PROVIDERS,
  MODEL_OPTIONS,
  PROVIDER_TO_ENV_VAR,
} from "./language_model_constants";
import { cloudProviders } from "@/lib/schemas";

describe("Kimi Code provider", () => {
  it("registers the dedicated API provider and its official model IDs", () => {
    expect(CLOUD_PROVIDERS["kimi-code"]).toMatchObject({
      displayName: "Kimi Code",
      websiteUrl: "https://www.kimi.com/code/console",
    });
    expect(PROVIDER_TO_ENV_VAR["kimi-code"]).toBe("KIMI_API_KEY");
    expect(cloudProviders).toContain("kimi-code");
    expect(MODEL_OPTIONS["kimi-code"].map((model) => model.name)).toEqual([
      "k3",
      "k3-256k",
      "kimi-for-coding",
      "kimi-for-coding-highspeed",
    ]);
  });

  it("uses the context windows documented by Kimi Code", () => {
    expect(
      Object.fromEntries(
        MODEL_OPTIONS["kimi-code"].map((model) => [
          model.name,
          model.contextWindow,
        ]),
      ),
    ).toEqual({
      k3: 1_048_576,
      "k3-256k": 256_000,
      "kimi-for-coding": 256_000,
      "kimi-for-coding-highspeed": 256_000,
    });
  });
});
