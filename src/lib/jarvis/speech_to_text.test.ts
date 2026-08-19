import { describe, expect, it } from "vitest";

import { resolveBatchSpeechToTextModel } from "./speech_to_text";

describe("resolveBatchSpeechToTextModel", () => {
  it("uses Scribe v2 by default", () => {
    expect(resolveBatchSpeechToTextModel()).toBe("scribe_v2");
  });

  it("keeps an explicitly configured batch model", () => {
    expect(resolveBatchSpeechToTextModel("scribe_v1")).toBe("scribe_v1");
    expect(resolveBatchSpeechToTextModel("scribe_v2")).toBe("scribe_v2");
  });

  it("does not send a realtime model id to the batch endpoint", () => {
    expect(resolveBatchSpeechToTextModel("scribe_v2_realtime")).toBe(
      "scribe_v2",
    );
  });
});
