import { beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({
  send: vi.fn(),
  routePresentation: vi.fn(() => "window-session"),
  endpointForSession: vi.fn(),
}));

vi.mock("@/window_infrastructure/main/window_registry", () => ({
  windowRegistry: {
    routePresentation: routing.routePresentation,
    endpointForSession: routing.endpointForSession,
    liveEndpoints: () => [],
  },
}));

vi.mock("@/window_infrastructure/main/query_invalidation_bus", () => ({
  queryInvalidationBus: { publish: vi.fn() },
}));

import { routePlanHandoffPresentation } from "./chat_actor_platform";

describe("routePlanHandoffPresentation", () => {
  beforeEach(() => {
    routing.send.mockClear();
    routing.endpointForSession.mockReturnValue({ send: routing.send });
  });

  it("keeps routing metadata out of the strict renderer payload", () => {
    routePlanHandoffPresentation({
      handoffId: "handoff",
      sourceChatId: 1,
      targetChatId: 2,
      appId: 3,
      originWindowSessionId: "origin",
    });

    expect(routing.send).toHaveBeenCalledWith("plan:handoff-presentation", {
      handoffId: "handoff",
      sourceChatId: 1,
      targetChatId: 2,
      appId: 3,
    });
  });
});
