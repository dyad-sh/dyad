import { describe, expect, it } from "vitest";

import { isSseInvalidJsonResponse } from "./chat_agent_response";

describe("isSseInvalidJsonResponse", () => {
  it("recognizes an SSE response sent to a non-streaming model request", () => {
    expect(
      isSseInvalidJsonResponse({
        message: "Invalid JSON response",
        responseHeaders: { "content-type": "text/event-stream; charset=utf-8" },
        responseBody: 'data: {"choices":[]}\n\n',
      }),
    ).toBe(true);
  });

  it("does not reinterpret ordinary invalid JSON as an event stream", () => {
    expect(
      isSseInvalidJsonResponse({
        message: "Invalid JSON response",
        responseHeaders: { "content-type": "text/html" },
        responseBody: "<html>Bad gateway</html>",
      }),
    ).toBe(false);
  });
});
