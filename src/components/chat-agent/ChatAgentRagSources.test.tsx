import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChatAgentRagSources,
  groupRagSources,
  ragSourceFolder,
  ragSourceGroupLocator,
  ragSourceLocator,
} from "./ChatAgentRagSources";
import type { ChatAgentRagSource } from "@/ipc/types/chat_agent";

const source: ChatAgentRagSource = {
  collectionId: "knowledge-base",
  collectionName: "Knowledge Base",
  sourceId: "tender",
  sourceName: "Buildcheck Tender Summary.pdf",
  sourcePath: "/vault/Documents/Buildcheck Tender Summary.pdf",
  page: 28,
  lineStart: null,
  lineEnd: null,
};

afterEach(cleanup);

describe("ChatAgentRagSources", () => {
  it("shows the indexed document and exact page used for the answer", () => {
    render(<ChatAgentRagSources sources={[source]} />);

    expect(screen.getByText("Sources consulted")).toBeTruthy();
    expect(
      screen
        .getByLabelText("Sources consulted")
        .classList.contains("chat-card-fly-in"),
    ).toBe(true);
    expect(screen.getByText(source.sourceName)).toBeTruthy();
    expect(screen.getByText(/Page 28/)).toBeTruthy();
    expect(screen.getByText("/vault/Documents")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("title")).toContain(
      source.sourcePath,
    );
  });

  it("groups pages from one document into one compact source card", () => {
    const pages = [51, 52, 8, 50, 7, 49, 35, 47, 14, 13, 15];
    const sources = pages.map((page) => ({ ...source, page }));

    render(<ChatAgentRagSources sources={sources} />);

    expect(screen.getAllByTestId("chat-rag-source-link")).toHaveLength(1);
    expect(
      screen
        .getByTestId("chat-rag-source-link")
        .textContent?.includes("Pages 7–8, 13–15, 35, 47, 49–52"),
    ).toBe(true);
    expect(groupRagSources(sources)).toHaveLength(1);
    expect(ragSourceGroupLocator(sources)).toBe(
      "Pages 7–8, 13–15, 35, 47, 49–52",
    );
  });

  it("does not merge documents that only share a display name", () => {
    expect(
      groupRagSources([
        source,
        {
          ...source,
          collectionId: "other-collection",
          sourceId: "other-source",
          sourcePath: "/another-vault/Buildcheck Tender Summary.pdf",
        },
      ]),
    ).toHaveLength(2);
  });

  it("formats text locations as line ranges", () => {
    expect(
      ragSourceLocator({
        ...source,
        sourceName: "notes.md",
        page: null,
        lineStart: 12,
        lineEnd: 20,
      }),
    ).toBe("Lines 12–20");
  });

  it("shows the source's folder on Windows and Unix paths", () => {
    expect(ragSourceFolder("/vault/Documents/notes.md")).toBe(
      "/vault/Documents",
    );
    expect(ragSourceFolder("C:\\Vault\\Documents\\notes.md")).toBe(
      "C:/Vault/Documents",
    );
  });
});
