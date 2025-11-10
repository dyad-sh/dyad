import { DEFAULT_LM_STUDIO_ENDPOINT } from "@/constants/localModels";
import {
  getLMStudioBaseUrl,
  normalizeLmStudioBaseUrl,
} from "@/ipc/utils/lm_studio_utils";
import { describe, expect, it } from "vitest";

describe("normalizeLmStudioBaseUrl", () => {
  it("returns default endpoint when value is undefined", () => {
    expect(normalizeLmStudioBaseUrl()).toBe(DEFAULT_LM_STUDIO_ENDPOINT);
  });

  it("trims whitespace and adds protocol", () => {
    expect(normalizeLmStudioBaseUrl("  localhost  ")).toBe(
      `${DEFAULT_LM_STUDIO_ENDPOINT}`,
    );
  });

  it("adds default port when missing", () => {
    expect(normalizeLmStudioBaseUrl("192.168.0.10")).toBe(
      "http://192.168.0.10:1234",
    );
  });

  it("adds default port when protocol provided without port", () => {
    expect(normalizeLmStudioBaseUrl("http://localhost")).toBe(
      "http://localhost:1234",
    );
    expect(normalizeLmStudioBaseUrl("https://example.com")).toBe(
      "https://example.com:1234",
    );
  });

  it("removes trailing /v1 if present", () => {
    expect(normalizeLmStudioBaseUrl("http://example.com:9000/v1")).toBe(
      "http://example.com:9000",
    );
    expect(normalizeLmStudioBaseUrl("http://example.com:9000/v1/")).toBe(
      "http://example.com:9000",
    );
  });

  it("preserves additional path segments", () => {
    expect(normalizeLmStudioBaseUrl("http://example.com/custom/path/")).toBe(
      "http://example.com:1234/custom/path",
    );
  });
});

describe("getLMStudioBaseUrl", () => {
  it("prefers env override when set", () => {
    const original = process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
    try {
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING = "http://override:9999/v1";
      expect(getLMStudioBaseUrl()).toBe("http://override:9999");
    } finally {
      if (original === undefined) {
        delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
      } else {
        process.env.LM_STUDIO_BASE_URL_FOR_TESTING = original;
      }
    }
  });
});
