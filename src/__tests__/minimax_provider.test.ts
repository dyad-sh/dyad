import { describe, it, expect } from "vitest";
import {
  MODEL_OPTIONS,
  PROVIDER_TO_ENV_VAR,
  CLOUD_PROVIDERS,
} from "@/ipc/shared/language_model_constants";

describe("MiniMax Provider Configuration", () => {
  describe("MODEL_OPTIONS", () => {
    it("has minimax provider defined", () => {
      expect(MODEL_OPTIONS).toHaveProperty("minimax");
    });

    it("has four MiniMax models", () => {
      expect(MODEL_OPTIONS.minimax).toHaveLength(4);
    });

    it("has MiniMax-M2.7 as the first (default) model", () => {
      expect(MODEL_OPTIONS.minimax[0].name).toBe("MiniMax-M2.7");
    });

    it("has MiniMax-M2.7-highspeed as the second model", () => {
      expect(MODEL_OPTIONS.minimax[1].name).toBe("MiniMax-M2.7-highspeed");
    });

    it("includes MiniMax-M2.7 model with correct properties", () => {
      const m27 = MODEL_OPTIONS.minimax.find(
        (m) => m.name === "MiniMax-M2.7",
      );
      expect(m27).toBeDefined();
      expect(m27!.displayName).toBe("MiniMax M2.7");
      expect(m27!.contextWindow).toBe(204_800);
      expect(m27!.temperature).toBe(1.0);
    });

    it("includes MiniMax-M2.7-highspeed model with correct properties", () => {
      const m27hs = MODEL_OPTIONS.minimax.find(
        (m) => m.name === "MiniMax-M2.7-highspeed",
      );
      expect(m27hs).toBeDefined();
      expect(m27hs!.displayName).toBe("MiniMax M2.7 High Speed");
      expect(m27hs!.contextWindow).toBe(204_800);
      expect(m27hs!.temperature).toBe(1.0);
    });

    it("includes MiniMax-M2.5 model", () => {
      const m25 = MODEL_OPTIONS.minimax.find(
        (m) => m.name === "MiniMax-M2.5",
      );
      expect(m25).toBeDefined();
      expect(m25!.displayName).toBe("MiniMax M2.5");
      expect(m25!.contextWindow).toBe(204_800);
      expect(m25!.temperature).toBe(1.0);
    });

    it("includes MiniMax-M2.5-highspeed model", () => {
      const m25hs = MODEL_OPTIONS.minimax.find(
        (m) => m.name === "MiniMax-M2.5-highspeed",
      );
      expect(m25hs).toBeDefined();
      expect(m25hs!.displayName).toBe("MiniMax M2.5 High Speed");
      expect(m25hs!.contextWindow).toBe(204_800);
      expect(m25hs!.temperature).toBe(1.0);
    });

    it("keeps M2.7 models before M2.5 models", () => {
      const names = MODEL_OPTIONS.minimax.map((m) => m.name);
      expect(names.indexOf("MiniMax-M2.7")).toBeLessThan(
        names.indexOf("MiniMax-M2.5"),
      );
      expect(names.indexOf("MiniMax-M2.7-highspeed")).toBeLessThan(
        names.indexOf("MiniMax-M2.5-highspeed"),
      );
    });
  });

  describe("PROVIDER_TO_ENV_VAR", () => {
    it("maps minimax to MINIMAX_API_KEY", () => {
      expect(PROVIDER_TO_ENV_VAR.minimax).toBe("MINIMAX_API_KEY");
    });
  });

  describe("CLOUD_PROVIDERS", () => {
    it("has minimax provider defined", () => {
      expect(CLOUD_PROVIDERS).toHaveProperty("minimax");
    });

    it("has correct display name", () => {
      expect(CLOUD_PROVIDERS.minimax.displayName).toBe("MiniMax");
    });

    it("has website URL", () => {
      expect(CLOUD_PROVIDERS.minimax.websiteUrl).toBe(
        "https://platform.minimax.io/",
      );
    });

    it("has gateway prefix", () => {
      expect(CLOUD_PROVIDERS.minimax.gatewayPrefix).toBe("minimax/");
    });

    it("is marked as secondary", () => {
      expect(CLOUD_PROVIDERS.minimax.secondary).toBe(true);
    });
  });
});

describe("MiniMax base URL handling", () => {
  it("appends /v1 to base URL without it", () => {
    const baseURL = "https://api.minimax.io/anthropic";
    const normalized = baseURL.endsWith("/v1")
      ? baseURL
      : `${baseURL.replace(/\/$/, "")}/v1`;
    expect(normalized).toBe("https://api.minimax.io/anthropic/v1");
  });

  it("does not double-append /v1", () => {
    const baseURL = "https://api.minimax.io/anthropic/v1";
    const normalized = baseURL.endsWith("/v1")
      ? baseURL
      : `${baseURL.replace(/\/$/, "")}/v1`;
    expect(normalized).toBe("https://api.minimax.io/anthropic/v1");
  });

  it("handles trailing slash before appending /v1", () => {
    const baseURL = "https://api.minimax.io/anthropic/";
    const normalized = baseURL.endsWith("/v1")
      ? baseURL
      : `${baseURL.replace(/\/$/, "")}/v1`;
    expect(normalized).toBe("https://api.minimax.io/anthropic/v1");
  });

  it("handles domestic base URL", () => {
    const baseURL = "https://api.minimaxi.com/anthropic";
    const normalized = baseURL.endsWith("/v1")
      ? baseURL
      : `${baseURL.replace(/\/$/, "")}/v1`;
    expect(normalized).toBe("https://api.minimaxi.com/anthropic/v1");
  });
});
