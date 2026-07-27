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

  it("does not offer persistent approval for bash", () => {
    render(
      <AgentConsentBanner
        consent={{
          kind: "agent",
          requestId: "request",
          chatId: 1,
          toolName: "bash",
          inputPreview: "npm test",
        }}
        onDecision={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Always allow")).toBeNull();
    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
  });
});
