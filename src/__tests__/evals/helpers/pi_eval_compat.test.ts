// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";

import { generateText } from "./pi_eval_compat";

describe("pi eval compatibility", () => {
  it("forwards maxRetries to the Pi provider", async () => {
    const faux = fauxProvider({
      provider: "eval-test",
      models: [{ id: "eval-model" }],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    let receivedMaxRetries: number | undefined;
    faux.setResponses([
      (_context, options) => {
        receivedMaxRetries = options?.maxRetries;
        return fauxAssistantMessage("ok");
      },
    ]);

    await generateText({
      model: { model: faux.getModel(), models },
      prompt: "test",
      maxRetries: 5,
    });

    expect(receivedMaxRetries).toBe(5);
  });
});
