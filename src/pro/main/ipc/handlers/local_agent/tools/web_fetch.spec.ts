import { beforeEach, describe, expect, it, vi } from "vitest";
import { webFetchTool } from "./web_fetch";
import type { AgentContext } from "./types";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe("webFetchTool", () => {
  const mockContext: AgentContext = {
    event: {} as any,
    appId: 1,
    appPath: "/test/app",
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    messageId: 1,
    isSharedModulesChanged: false,
    isDyadPro: false,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has the correct name and default consent", () => {
    expect(webFetchTool.name).toBe("web_fetch");
    expect(webFetchTool.defaultConsent).toBe("ask");
  });

  it("applies markdown as the default format", () => {
    const parsed = webFetchTool.inputSchema.parse({
      url: "https://example.com",
    });
    expect(parsed.format).toBe("markdown");
  });

  it("rejects non-http(s) URLs", async () => {
    await expect(
      webFetchTool.execute(
        { url: "file:///tmp/test.txt", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("URL must start with http:// or https://");
  });

  it("returns text extracted from html for text format", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        "<html><body><h1>Title</h1><p>Hello <strong>world</strong>.</p></body></html>",
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      ),
    );

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "text" },
      mockContext,
    );

    expect(result).toContain("Title");
    expect(result).toContain("Hello world.");
    expect(result).not.toContain("<h1>");
  });

  it("returns html unchanged for html format", async () => {
    const html = "<html><body><h1>Title</h1></body></html>";
    vi.mocked(fetch).mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      }),
    );

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "html" },
      mockContext,
    );

    expect(result).toBe(html);
  });

  it("rejects responses above the 5MB content-length limit", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("small", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "content-length": String(6 * 1024 * 1024),
        },
      }),
    );

    await expect(
      webFetchTool.execute(
        { url: "https://example.com", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("Response too large (exceeds 5MB limit)");
  });

  it("returns a binary content summary for images", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      }),
    );

    const result = await webFetchTool.execute(
      { url: "https://example.com/image.png", format: "markdown" },
      mockContext,
    );

    expect(result).toContain("Fetched binary image content");
    expect(result).toContain("image/png");
  });

  it("throws on non-2xx responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Not found", {
        status: 404,
      }),
    );

    await expect(
      webFetchTool.execute(
        { url: "https://example.com/missing", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("Request failed with status code: 404");
  });
});
