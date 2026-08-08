import { describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { UserSettings } from "@/lib/schemas";
import {
  buildChatAgentSystemToolSet,
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
          {
            ...event,
          },
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
