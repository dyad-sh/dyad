import { beforeEach, describe, expect, it, vi } from "vitest";
import { webFetchTool } from "./web_fetch";
import type { AgentContext } from "./types";
import { lookup } from "node:dns/promises";

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

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
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
    (vi.mocked(lookup) as any).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
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

  it("converts html to markdown for markdown format", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        '<html><body><h1>Title</h1><p>Hello <strong>bold</strong> and <em>italic</em>.</p><a href="https://example.com">link</a><ul><li>item</li></ul><pre>code block</pre></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      ),
    );

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "markdown" },
      mockContext,
    );

    expect(result).toContain("# Title");
    expect(result).toContain("**bold**");
    expect(result).toContain("*italic*");
    expect(result).toContain("[link](https://example.com)");
    expect(result).toContain("- item");
    expect(result).toContain("```");
  });

  it("rejects private/internal network addresses", async () => {
    await expect(
      webFetchTool.execute(
        { url: "http://127.0.0.1/admin", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");

    await expect(
      webFetchTool.execute(
        { url: "http://localhost/admin", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");

    await expect(
      webFetchTool.execute(
        { url: "http://169.254.169.254/latest/meta-data/", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");
  });

  it("rejects private IPv6 addresses", async () => {
    await expect(
      webFetchTool.execute(
        { url: "http://[::1]/admin", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");

    await expect(
      webFetchTool.execute(
        { url: "http://[fc00::1]/admin", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");

    await expect(
      webFetchTool.execute(
        { url: "http://[fe80::1]/admin", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");
  });

  it("rejects IPv4-mapped IPv6 addresses pointing to private IPs", async () => {
    // ::ffff:7f00:1 is the hex form of ::ffff:127.0.0.1
    // Node's URL parser normalizes [::ffff:127.0.0.1] to this form
    await expect(
      webFetchTool.execute(
        { url: "http://[::ffff:127.0.0.1]/admin", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");
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

  it("returns a binary content summary for non-image binary types", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
        status: 200,
        headers: {
          "content-type": "application/zip",
        },
      }),
    );

    const result = await webFetchTool.execute(
      { url: "https://example.com/file.zip", format: "text" },
      mockContext,
    );

    expect(result).toContain("Fetched binary content");
    expect(result).toContain("application/zip");
    expect(result).toContain("only returns text-like content");
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

  it("truncates output exceeding 60K characters", async () => {
    const longContent = "a".repeat(70_000);
    vi.mocked(fetch).mockResolvedValue(
      new Response(longContent, {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      }),
    );

    const result = await webFetchTool.execute(
      { url: "https://example.com/long", format: "text" },
      mockContext,
    );

    expect(result).toContain("[truncated 10000 characters]");
    expect(result.length).toBeLessThan(70_000);
  });

  it("handles timeout via AbortError", async () => {
    vi.mocked(fetch).mockImplementation(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    });

    await expect(
      webFetchTool.execute(
        { url: "https://example.com/slow", format: "text", timeout: 1 },
        mockContext,
      ),
    ).rejects.toThrow("Request timed out after 1s");
  });

  it("blocks redirects to private IP addresses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/admin",
        },
      }),
    );

    await expect(
      webFetchTool.execute(
        { url: "https://example.com/redirect", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("private or internal network address");
  });

  it("follows safe redirects and returns content", async () => {
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              location: "https://example.com/final",
            },
          }),
        );
      }
      return Promise.resolve(
        new Response("Final content", {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        }),
      );
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com/start", format: "text" },
      mockContext,
    );

    expect(result).toBe("Final content");
    expect(callCount).toBe(2);
  });

  it("rejects domains that resolve to private IPs", async () => {
    (vi.mocked(lookup) as any).mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(
      webFetchTool.execute(
        { url: "https://evil.example.com/", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("URL resolves to a private or internal network address");
  });

  it("enforces streaming body size limit", async () => {
    // Create a response body that exceeds the 5MB limit via streaming
    const chunkSize = 1024 * 1024; // 1MB chunks
    const chunk = new Uint8Array(chunkSize);
    let chunksSent = 0;

    const stream = new ReadableStream({
      pull(controller) {
        chunksSent++;
        if (chunksSent <= 6) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
    });

    vi.mocked(fetch).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      }),
    );

    await expect(
      webFetchTool.execute(
        { url: "https://example.com/large-stream", format: "text" },
        mockContext,
      ),
    ).rejects.toThrow("Response too large (exceeds 5MB limit)");
  });
});
