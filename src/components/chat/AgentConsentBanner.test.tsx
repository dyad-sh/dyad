import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentConsentBanner } from "./AgentConsentBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        changesDatabaseSchema: "Changes database schema",
      })[key] ?? key,
  }),
}));

describe("AgentConsentBanner", () => {
  it("shows schema mutation metadata when present", () => {
    render(
      <AgentConsentBanner
        consent={{
          kind: "agent",
          requestId: "request",
          chatId: 1,
          toolName: "execute_sql",
          inputPreview: "CREATE TABLE users (id bigint);",
          metadata: { sqlMutatesSchema: true },
        }}
        onDecision={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Changes database schema")).toBeTruthy();
  });

  it("shows the server name and classifier reason for an MCP consent", () => {
    render(
      <AgentConsentBanner
        consent={{
          kind: "mcp",
          requestId: "request",
          chatId: 1,
          toolName: "send_email",
          serverName: "email-server",
          classifierReason: "Sends an email to an external address.",
        }}
        onDecision={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("email-server")).toBeTruthy();
    expect(
      screen.getByText(/Sends an email to an external address/),
    ).toBeTruthy();
  });
});
