import { describe, expect, it } from "vitest";

import { resolveChatAgentDataSourceScope } from "./chat_agent_data_source_scope";

describe("resolveChatAgentDataSourceScope", () => {
  it("inherits enabled sources when a conversation has no saved subset", () => {
    expect(
      resolveChatAgentDataSourceScope(undefined, ["osint", "orders"]),
    ).toEqual(["osint", "orders"]);
    expect(resolveChatAgentDataSourceScope([], ["osint"])).toEqual(["osint"]);
  });

  it("preserves an explicit per-conversation subset", () => {
    expect(
      resolveChatAgentDataSourceScope(["osint", "osint"], ["osint", "orders"]),
    ).toEqual(["osint"]);
  });
});
