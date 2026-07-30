import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { CatalogCard, type CatalogCardStatus } from "./CatalogCard";

const entry: McpCatalogEntry = {
  slug: "example",
  name: "Example",
  transport: "http",
  url: "https://mcp.example.com/mcp",
};

function renderCard(status: CatalogCardStatus, isAdding = false) {
  return render(
    <CatalogCard
      entry={entry}
      status={status}
      isAdding={isAdding}
      onAdd={vi.fn()}
    />,
  );
}

describe("CatalogCard status", () => {
  it("offers Add when the entry isn't added yet", () => {
    renderCard("not-added");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.queryByText("Added")).toBeNull();
  });

  it("shows progress while adding", () => {
    renderCard("not-added", true);
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Adding…",
    });
    expect(button.disabled).toBe(true);
  });

  it("reports a connect in flight rather than claiming it's done", () => {
    renderCard("connecting");
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.queryByText("Added")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("reports an added server that still isn't connected", () => {
    renderCard("needs-connect");
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByText("Added")).toBeNull();
  });

  it("shows Added once there's nothing left to do", () => {
    renderCard("added");
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  // The label changes as a connect progresses, so it has to sit in a
  // region assistive tech watches.
  it.each(["connecting", "needs-connect", "added"] as const)(
    "announces the %s state through a status role",
    (status) => {
      renderCard(status);
      expect(screen.getByRole("status")).toBeTruthy();
    },
  );

  it("keeps the decorative icon out of the announced text", () => {
    renderCard("connecting");
    expect(screen.getByRole("status").textContent).toBe("Connecting…");
  });
});
