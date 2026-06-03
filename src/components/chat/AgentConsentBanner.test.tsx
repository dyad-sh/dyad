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
});
