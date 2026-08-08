import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { ChatAgentLovableProjectCards } from "./ChatAgentLovableProjectCards";

type LovablePresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "lovable-projects" }
>;

describe("ChatAgentLovableProjectCards", () => {
  it("renders project artwork, metadata, and available actions", () => {
    const presentation: LovablePresentation = {
      kind: "lovable-projects",
      toolName: "get_project",
      heading: "Project details",
      projects: [
        {
          id: "project-1",
          name: "Launchpad",
          workspace: "Acme",
          screenshotUrl: "https://cdn.lovable.dev/launchpad.png",
          previewUrl: "https://preview.lovable.app/",
          editorUrl: "https://lovable.dev/projects/project-1",
          publishedUrl: "https://launchpad.lovable.app/",
          status: "ready",
          visibility: "private",
          updatedAt: "2026-07-29T02:00:00Z",
        },
      ],
    };

    render(<ChatAgentLovableProjectCards presentation={presentation} />);

    expect(screen.getByText("Launchpad")).toBeTruthy();
    expect(screen.getByText(/Acme · project-1/)).toBeTruthy();
    expect(screen.getByAltText("Launchpad preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Live site" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeTruthy();
  });
});
