import { describe, expect, it } from "vitest";

import { convertRemoteCatalog } from "./remote_language_model_catalog";
import { MODEL_OPTIONS } from "./language_model_constants";

// A model MODEL_OPTIONS tags text-only. Read from the constant rather than
// hardcoded so this test fails loudly if the tag is ever dropped.
const TEXT_ONLY = MODEL_OPTIONS.openrouter.find(
  (m) => m.name === "z-ai/glm-5.2",
)!;

function remoteCatalog(
  model: Partial<{ apiName: string; supportsVision: boolean }>,
) {
  return {
    version: "test",
    providers: [],
    modelsByProvider: {
      openrouter: [
        {
          apiName: model.apiName ?? TEXT_ONLY.name,
          displayName: "GLM 5.2",
          description: "from the server",
          ...(model.supportsVision === undefined
            ? {}
            : { supportsVision: model.supportsVision }),
        },
      ],
    },
    aliases: [],
  };
}

function convertedModel(catalog: ReturnType<typeof remoteCatalog>) {
  return convertRemoteCatalog(catalog).modelsByProvider.openrouter[0];
}

describe("convertRemoteCatalog supportsVision overlay", () => {
  it("guards the fixture: the model is tagged text-only locally", () => {
    expect(TEXT_ONLY.supportsVision).toBe(false);
  });

  it("fills supportsVision from MODEL_OPTIONS when the server is silent", () => {
    // The whole point: a remote provider entry shadows MODEL_OPTIONS in
    // getLanguageModels, so without the overlay this reads back undefined and
    // the vision fallback never fires.
    expect(convertedModel(remoteCatalog({})).supportsVision).toBe(false);
  });

  it("lets a server-supplied true override the local false", () => {
    expect(
      convertedModel(remoteCatalog({ supportsVision: true })).supportsVision,
    ).toBe(true);
  });

  it("keeps a server-supplied false", () => {
    expect(
      convertedModel(remoteCatalog({ supportsVision: false })).supportsVision,
    ).toBe(false);
  });

  it("leaves models absent from MODEL_OPTIONS undefined", () => {
    expect(
      convertedModel(remoteCatalog({ apiName: "vendor/not-in-model-options" }))
        .supportsVision,
    ).toBeUndefined();
  });

  it("does not disturb the other mapped fields", () => {
    const model = convertedModel(remoteCatalog({}));
    expect(model.displayName).toBe("GLM 5.2");
    expect(model.description).toBe("from the server");
    expect(model.type).toBe("cloud");
  });
});
