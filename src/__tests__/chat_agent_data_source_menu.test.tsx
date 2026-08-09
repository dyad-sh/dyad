import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ChatAgentDataSourceMenu } from "@/components/chat-agent/ChatAgentDataSourceMenu";

const listMock = vi.fn();

vi.mock("@/ipc/types", () => ({
  ipc: { dataSource: { list: () => listMock() } },
}));

const source = (over: Record<string, unknown> = {}) => ({
  id: "a",
  provider: "supabase",
  name: "WorkPlace Interventions",
  description: "",
  projectUrl: "https://x.supabase.co",
  environment: "production",
  credentialType: "anon",
  keyId: "SUP-8F3A21",
  accessMode: "read_only",
  enabled: true,
  status: "connected",
  statusMessage: "",
  hasCredential: true,
  tableCount: 7,
  relationshipCount: 2,
  lastConnectedAt: 1,
  lastSchemaSyncAt: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

function renderMenu(selected: string[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChatAgentDataSourceMenu
        selectedDataSourceIds={selected}
        onChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
});

describe("ChatAgentDataSourceMenu", () => {
  it("renders a trigger the composer can show", async () => {
    listMock.mockResolvedValue([]);
    renderMenu();
    expect(
      await screen.findByTestId("chat-agent-data-source-menu"),
    ).toBeTruthy();
  });

  it("marks the trigger active only when something is selected", async () => {
    listMock.mockResolvedValue([source()]);

    const { unmount } = renderMenu([]);
    const idle = await screen.findByTestId("chat-agent-data-source-menu");
    expect(idle.className).not.toContain("--active");
    unmount();

    renderMenu(["a"]);
    const active = await screen.findByTestId("chat-agent-data-source-menu");
    expect(active.className).toContain("--active");
  });

  it("never receives a credential to render", async () => {
    // The DTO carries no secret, so there is nothing here that could leak one
    // into the DOM even by accident.
    listMock.mockResolvedValue([source()]);
    const { container } = renderMenu(["a"]);
    await screen.findByTestId("chat-agent-data-source-menu");
    expect(container.innerHTML).not.toMatch(/sb_secret|sb_publishable|eyJ/);
  });
});
