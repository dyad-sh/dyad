import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@/i18n";
import { AgentToolsSettings } from "./AgentToolsSettings";

vi.mock("@/hooks/useAgentTools", () => ({
  useAgentTools: () => ({
    isLoading: false,
    setConsent: vi.fn(),
    tools: [
      { name: "write_file", description: "Write a file", consent: "ask" },
      { name: "delete_file", description: "Delete a file", consent: "ask" },
      {
        name: "read_file",
        description: "Read a file",
        consent: "always",
        isAllowedByDefault: true,
      },
    ],
  }),
}));

afterEach(cleanup);

it("identifies each permission selector by its visible tool name", () => {
  render(<AgentToolsSettings />);

  for (const name of ["write_file", "delete_file"]) {
    const selector = screen.getByRole("combobox", { name });
    expect(selector.textContent).toContain("ask");
  }

  const disclosure = screen.getByRole("button", {
    name: "Default allowed tools (1)",
  });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(
    screen.getByRole("combobox", { name: "read_file" }).textContent,
  ).toContain("always");
});
