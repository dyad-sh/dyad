import { beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({
  send: vi.fn(),
  routePresentation: vi.fn<() => string | null>(() => "window-session"),
  endpointForSession: vi.fn(),
  liveEndpoints: vi.fn(() => []),
  publishInvalidations: vi.fn(),
}));

vi.mock("@/window_infrastructure/main/window_registry", () => ({
  windowRegistry: {
    routePresentation: routing.routePresentation,
    endpointForSession: routing.endpointForSession,
    liveEndpoints: routing.liveEndpoints,
  },
}));

vi.mock("@/window_infrastructure/main/query_invalidation_bus", () => ({
  queryInvalidationBus: { publish: routing.publishInvalidations },
}));

import {
  chatExecutionEndpoint,
  publishChatInvalidations,
  routePlanHandoffPresentation,
} from "./chat_actor_platform";

describe("routePlanHandoffPresentation", () => {
  beforeEach(() => {
    routing.send.mockClear();
    routing.routePresentation.mockReturnValue("window-session");
    routing.endpointForSession.mockReturnValue({ send: routing.send });
    routing.liveEndpoints.mockReturnValue([]);
    routing.publishInvalidations.mockClear();
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

  it("does not expose the no-window execution endpoint as registrable", () => {
    routing.routePresentation.mockReturnValue(null);
    routing.endpointForSession.mockReturnValue(undefined);

    const endpoint = chatExecutionEndpoint(1);

    expect(Number.isInteger(endpoint.id)).toBe(false);
    expect(endpoint.isDestroyed()).toBe(true);
  });

  it("publishes chat and target-app completion invalidations from main", () => {
    publishChatInvalidations(1, 7);

    expect(routing.publishInvalidations).toHaveBeenCalledWith([
      { family: "chats" },
      { family: "chat", chatId: 1 },
      { family: "token-count" },
      { family: "app", appId: 7 },
      { family: "versions", appId: 7 },
      { family: "uncommitted-files", appId: 7 },
    ]);
  });
});
