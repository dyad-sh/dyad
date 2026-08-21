import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatAgentActivityIndicator } from "./ChatAgentActivityIndicator";
import { ChatAgentDatabaseResultCard } from "./ChatAgentDatabaseResultCard";
import { ChatAgentToolResultCard } from "./ChatAgentToolResultCard";
import { ChatAgentOsintProfileCards } from "./ChatAgentOsintProfileCards";

describe("Chat Agent tool feedback", () => {
  it("keeps a thinking state while the model is reasoning", () => {
    render(<ChatAgentActivityIndicator />);

    expect(screen.getByRole("status").textContent).toContain("Thinking");
    expect(screen.getByTestId("thinking-indicator")).toBeTruthy();
  });

  it("names the active tool in the thinking state", () => {
    render(
      <ChatAgentActivityIndicator activeTool="Searching Amadeus flights" />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Searching Amadeus flights",
    );
  });

  it("switches to a RAG tool state while accessing local knowledge", () => {
    render(
      <ChatAgentActivityIndicator activeTool="Accessing local knowledge base" />,
    );

    expect(screen.getByRole("status").textContent).toContain("Using RAG");
    expect(screen.getByTestId("tool-activity-spinner")).toBeTruthy();
  });

  it("uses a clear Web Search label for the search tool", () => {
    render(<ChatAgentActivityIndicator activeTool="Searching the web" />);

    expect(screen.getByRole("status").textContent).toContain(
      "Using Web Search",
    );
  });

  it("renders generic structured tool output as a readable card", () => {
    render(
      <ChatAgentToolResultCard
        result={{
          serverName: "Lovable",
          toolName: "get_project_status",
          status: "completed",
          result: JSON.stringify({
            projectName: "Guardian Hub",
            status: "ready",
            previewUrl: "https://guardian.lovable.app",
            deploymentCount: 3,
          }),
        }}
      />,
    );

    expect(screen.getByText("Get Project Status")).toBeTruthy();
    expect(screen.getByText("Guardian Hub")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /guardian\.lovable\.app/ }),
    ).toBeTruthy();
    expect(screen.getByText("View raw response")).toBeTruthy();
    expect(
      screen
        .getByText("Get Project Status")
        .closest("section")
        ?.classList.contains("chat-card-fly-in"),
    ).toBe(true);
  });

  it("renders database query rows as a dedicated result card", () => {
    render(
      <ChatAgentDatabaseResultCard
        presentation={{
          kind: "database-result",
          sourceName: "WPI Website",
          table: "orders",
          columns: ["order_number", "status", "total"],
          rows: [["WPI-1042", "paid", "149.00"]],
          totalRows: 1,
          executionMs: 18,
          truncatedColumns: 0,
        }}
      />,
    );

    const card = screen.getByTestId("chat-agent-db-result");
    expect(card.textContent).toContain("WPI Website");
    expect(card.textContent).toContain("orders");
    expect(card.textContent).toContain("WPI-1042");
    expect(card.textContent).toContain("paid");
  });

  it("renders an OSINT person as a visual profile with linked evidence", () => {
    render(
      <ChatAgentOsintProfileCards
        presentation={{
          kind: "osint-profiles",
          sourceName: "osintstore",
          table: "people",
          executionMs: 14,
          records: [
            {
              id: "1",
              entityType: "person",
              name: "Bruce Wayne",
              subtitle: "US",
              description: "Fictional QA record",
              imageUrl: "dyad-media://vault/bruce.jpg",
              fields: [{ label: "Date Of Birth", value: "19 Feb 1972" }],
              evidence: [
                {
                  id: "7",
                  title: "Bruce Wayne portrait",
                  itemType: "image",
                  relationship: "profile_image",
                  url: "dyad-media://vault/bruce.jpg",
                  mimeType: "image/jpeg",
                },
              ],
            },
          ],
        }}
      />,
    );

    const card = screen.getByTestId("chat-agent-osint-profiles");
    expect(card.textContent).toContain("Bruce Wayne");
    expect(card.textContent).toContain("Person profile");
    expect(card.textContent).toContain("Bruce Wayne portrait");
    expect(screen.getByAltText("Bruce Wayne profile")).toBeTruthy();

    fireEvent.click(screen.getByText("Bruce Wayne portrait"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByAltText("Bruce Wayne portrait")).toBeTruthy();
  });
});
