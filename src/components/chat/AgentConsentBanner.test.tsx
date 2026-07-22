import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentConsentBanner } from "./AgentConsentBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        changesDatabaseSchema: "Changes database schema",
        destructiveDataChange: "Destructive data change",
        aiReviewingRequest:
          "AI is reviewing this request to decide if it's safe to auto-approve…",
      })[key] ?? key,
  }),
}));

describe("AgentConsentBanner", () => {
  it("attributes Implementer consent to the child task", () => {
    render(
      <AgentConsentBanner
        consent={{
          kind: "agent",
          requestId: "request",
          chatId: 1,
          toolName: "write_file",
          subagent: {
            threadId: "thread-1",
            persona: "implementer",
            taskName: "Update auth flow",
          },
        }}
        onDecision={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Requested by implementer/)).toBeTruthy();
    expect(screen.getByText("Update auth flow")).toBeTruthy();
  });

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

  it("shows destructive data metadata when present", () => {
    render(
      <AgentConsentBanner
        consent={{
          kind: "agent",
          requestId: "request",
          chatId: 1,
          toolName: "execute_sql",
          inputPreview: "DELETE FROM users WHERE id = 1;",
          metadata: { sqlMutatesSchema: false, sqlDeletesData: true },
        }}
        onDecision={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Destructive data change")).toBeTruthy();
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

  it("shows the reviewing spinner and live buttons while the classifier is pending", () => {
    render(
      <AgentConsentBanner
        consent={{
          kind: "mcp",
          requestId: "request",
          chatId: 1,
          toolName: "calculator_add",
          serverName: "calc-server",
          classifierPending: true,
        }}
        onDecision={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/reviewing this request/i)).toBeTruthy();
    // Buttons stay clickable during review.
    expect(screen.getByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });
});
