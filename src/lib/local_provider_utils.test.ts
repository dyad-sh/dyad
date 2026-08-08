import { describe, expect, it } from "vitest";
import {
  getLMStudioApiBaseUrl,
  getLMStudioBaseUrlFromSettings,
  getOllamaBaseUrlFromSettings,
  parseLMStudioBaseUrl,
  parseOllamaBaseUrl,
} from "./local_provider_utils";

describe("parseLMStudioBaseUrl", () => {
  it("defaults to localhost:1234", () => {
    expect(parseLMStudioBaseUrl()).toBe("http://localhost:1234");
  });

  it("strips /v1 suffix and adds http scheme", () => {
    expect(parseLMStudioBaseUrl("localhost:1234/v1")).toBe(
      "http://localhost:1234",
    );
  });
});

describe("getLMStudioApiBaseUrl", () => {
  it("appends /v1 when missing", () => {
    expect(
      getLMStudioApiBaseUrl({
        providerSettings: {
          lmstudio: { apiBaseUrl: "http://192.168.1.10:1234" },
        },
      } as never),
    ).toBe("http://192.168.1.10:1234/v1");
  });
});

describe("getLMStudioBaseUrlFromSettings", () => {
  it("uses saved apiBaseUrl from provider settings", () => {
    expect(
      getLMStudioBaseUrlFromSettings({
        providerSettings: {
          lmstudio: { apiBaseUrl: "http://192.168.1.10:1234" },
        },
      } as never),
    ).toBe("http://192.168.1.10:1234");
  });
});

describe("parseOllamaBaseUrl", () => {
  it("defaults to localhost:11434", () => {
    expect(parseOllamaBaseUrl()).toBe("http://localhost:11434");
  });

  it("preserves full http URL", () => {
    expect(parseOllamaBaseUrl("http://10.0.0.5:11434")).toBe(
      "http://10.0.0.5:11434",
    );
  });
});

describe("getOllamaBaseUrlFromSettings", () => {
  it("uses saved apiBaseUrl from provider settings", () => {
    expect(
      getOllamaBaseUrlFromSettings({
        providerSettings: {
          ollama: { apiBaseUrl: "http://10.0.0.5:11434" },
        },
      } as never),
    ).toBe("http://10.0.0.5:11434");
  });
});
