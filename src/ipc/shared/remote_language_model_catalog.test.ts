import { afterEach, describe, expect, it, vi } from "vitest";
import { getBuiltinLanguageModelCatalog } from "./remote_language_model_catalog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote language model catalog", () => {
  it("keeps a nonempty remote auto-model list authoritative", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            version: "test",
            expiresAt: "2099-01-01T00:00:00.000Z",
            providers: [],
            modelsByProvider: {
              auto: [
                {
                  apiName: "remote-auto",
                  displayName: "Remote Auto",
                  description: "The remotely configured Auto option",
                },
              ],
            },
            aliases: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const catalog = await getBuiltinLanguageModelCatalog();

    expect(catalog.modelsByProvider.auto).toEqual([
      expect.objectContaining({ apiName: "remote-auto" }),
    ]);
  });
});
