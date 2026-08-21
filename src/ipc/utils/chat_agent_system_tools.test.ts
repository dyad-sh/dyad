import { describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { UserSettings } from "@/lib/schemas";

import {
  buildChatAgentSystemToolSet,
  isTerminalApplication,
  stripHtmlToText,
} from "./chat_agent_system_tools";

const event = {
  sender: { send: vi.fn() },
} as unknown as IpcMainInvokeEvent;

const settings: UserSettings = {
  selectedModel: { provider: "auto", name: "auto" },
  providerSettings: {},
  selectedTemplateId: "react",
  enableAutoUpdate: true,
  releaseChannel: "stable",
};

describe("Chat Agent system tools", () => {
  it("keeps every system tool unavailable by default", () => {
    expect(
      Object.keys(buildChatAgentSystemToolSet(event, settings, vi.fn())),
    ).toEqual([]);
  });

  it("exposes only explicitly enabled permissions", () => {
    expect(
      Object.keys(
        buildChatAgentSystemToolSet(
          { ...event },
          {
            ...settings,
            chatAgentSystemAccess: {
              terminal: true,
              browser: false,
              computer: true,
            },
          },
          vi.fn(),
        ),
      ),
    ).toEqual(["run_terminal_command", "use_computer"]);
  });

  it("exposes native profile and composer tools for a connected X account", async () => {
    const onResult = vi.fn();
    const tools = buildChatAgentSystemToolSet(
      event,
      {
        ...settings,
        socialMedia: {
          x: {
            authType: "oauth2",
            accessToken: { value: "encrypted-token" },
            username: "724real",
            displayName: "724",
            profileImageUrl: "https://example.com/avatar.jpg",
            bio: "Code. Train. Shred.",
            verified: true,
            followersCount: 3181,
            followingCount: 5638,
            postCount: 661,
          },
        },
      },
      onResult,
    );

    expect(Object.keys(tools)).toEqual([
      "get_connected_x_profile",
      "compose_x_post",
    ]);

    await tools.get_connected_x_profile.execute?.({}, {} as never);
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        presentation: expect.objectContaining({
          kind: "x-profile",
          username: "724real",
          followersCount: 3181,
        }),
      }),
    );

    await tools.compose_x_post.execute?.(
      {
        content: "The Red Special is a blueprint for creativity. 🎸",
        imagePrompt: "Brian May inspired handmade red guitar on a dark stage",
      },
      {} as never,
    );
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: expect.objectContaining({
          kind: "x-post-composer",
          username: "724real",
          content: expect.stringContaining("Red Special"),
        }),
      }),
    );
  });

  it("turns an HTML document into compact readable text", () => {
    expect(
      stripHtmlToText(`
        <html>
          <head><style>.hidden { display: none }</style></head>
          <body><h1>Example &amp; result</h1><script>alert("x")</script>
          <p>Useful content.</p></body>
        </html>
      `),
    ).toBe("Example & result Useful content.");
  });
});

describe("isTerminalApplication", () => {
  it.each(["Terminal", "Terminal.app", " iTerm2 ", "Warp", "WezTerm"])(
    "blocks %s",
    (application) => {
      expect(isTerminalApplication(application)).toBe(true);
    },
  );

  it.each(["Safari", "Finder", "Visual Studio Code"])(
    "allows %s",
    (application) => {
      expect(isTerminalApplication(application)).toBe(false);
    },
  );
});
