import { describe, expect, it } from "vitest";
import { buildLovableToolPresentation } from "./lovable_mcp_presentations";

describe("Lovable MCP project presentations", () => {
  it("normalizes a wrapped project list with thumbnails and URLs", () => {
    const result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            projects: [
              {
                project_id: "project-1",
                name: "Launchpad",
                workspace: { name: "Acme" },
                screenshot_url: "https://cdn.lovable.dev/launchpad.png",
                preview_url: "https://preview.lovable.app",
                editor_url: "https://lovable.dev/projects/project-1",
                published_url: "https://launchpad.lovable.app",
                updated_at: "2026-07-29T02:00:00Z",
                visibility: "private",
              },
            ],
          }),
        },
      ],
    };

    expect(buildLovableToolPresentation("list_projects", result)).toEqual({
      kind: "lovable-projects",
      toolName: "list_projects",
      heading: "1 Lovable project",
      projects: [
        expect.objectContaining({
          id: "project-1",
          name: "Launchpad",
          workspace: "Acme",
          screenshotUrl: "https://cdn.lovable.dev/launchpad.png",
          previewUrl: "https://preview.lovable.app/",
          editorUrl: "https://lovable.dev/projects/project-1",
          publishedUrl: "https://launchpad.lovable.app/",
          visibility: "private",
        }),
      ],
    });
  });

  it("normalizes a single get_project structured result", () => {
    expect(
      buildLovableToolPresentation("get_project", {
        structuredContent: {
          id: "project-2",
          description: "Customer portal",
          sandbox_url: "https://sandbox.lovable.app",
          screenshot: { url: "https://cdn.lovable.dev/portal.webp" },
          build_status: "ready",
        },
      }),
    ).toMatchObject({
      kind: "lovable-projects",
      heading: "Project details",
      projects: [
        {
          id: "project-2",
          name: "Customer portal",
          status: "ready",
          screenshotUrl: "https://cdn.lovable.dev/portal.webp",
        },
      ],
    });
  });

  it("leaves non-project Lovable tools on the normal tool renderer", () => {
    expect(
      buildLovableToolPresentation("read_file", { path: "src/App.tsx" }),
    ).toBeUndefined();
  });
});
