import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => {
  const from = vi.fn();
  const select = vi.fn(() => ({ from }));
  return { select, from };
});

vi.mock("@/db", () => ({
  db: {
    select: dbMocks.select,
  },
}));

vi.mock("@/db/schema", () => ({
  language_model_providers: {},
  language_models: {},
}));

import { getLanguageModelProviders } from "@/ipc/shared/language_model_helpers";

describe("getLanguageModelProviders", () => {
  beforeEach(() => {
    dbMocks.select.mockClear();
    dbMocks.from.mockClear();
  });

  it("includes custom providers when the database query succeeds", async () => {
    dbMocks.from.mockResolvedValueOnce([
      {
        id: "custom::acme",
        name: "Acme",
        api_base_url: "https://api.acme.test/v1",
        env_var_name: "ACME_API_KEY",
      },
    ]);

    const providers = await getLanguageModelProviders();
    const customProvider = providers.find(
      (provider) => provider.id === "custom::acme",
    );

    expect(customProvider).toEqual({
      id: "custom::acme",
      name: "Acme",
      apiBaseUrl: "https://api.acme.test/v1",
      envVarName: "ACME_API_KEY",
      type: "custom",
    });
  });

  it("falls back to hardcoded providers when the database query fails", async () => {
    dbMocks.from.mockRejectedValueOnce(
      new Error("The database connection is not open"),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const providers = await getLanguageModelProviders();

    expect(providers.length).toBeGreaterThan(0);
    expect(providers.some((provider) => provider.type === "cloud")).toBe(true);
    expect(providers.some((provider) => provider.type === "local")).toBe(true);
    expect(providers.some((provider) => provider.type === "custom")).toBe(
      false,
    );
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
