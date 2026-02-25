import { describe, it, expect, vi, beforeEach } from "vitest";
import { webFetchTool } from "./web_fetch";
import type { AgentContext } from "./types";

// Mock fetch globally
global.fetch = vi.fn();

describe("web_fetch tool", () => {
  let mockContext: AgentContext;

  beforeEach(() => {
    mockContext = {
      event: {} as any,
      appId: 1,
      appPath: "/test/app",
      chatId: 1,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      messageId: 1,
      isSharedModulesChanged: false,
      todos: [],
      dyadRequestId: "test-request-id",
      fileEditTracker: {},
      isDyadPro: true,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
      requireConsent: vi.fn().mockResolvedValue(true),
      appendUserMessage: vi.fn(),
      onUpdateTodos: vi.fn(),
    };

    vi.clearAllMocks();
  });

  it("should have correct name and schema", () => {
    expect(webFetchTool.name).toBe("web_fetch");
    expect(webFetchTool.description).toContain("Fetches content from a URL");
    expect(webFetchTool.inputSchema).toBeDefined();
  });

  it("should reject non-http URLs", async () => {
    await expect(
      webFetchTool.execute(
        { url: "ftp://example.com", format: "markdown" },
        mockContext,
      ),
    ).rejects.toThrow("URL must start with http:// or https://");
  });

  it("should fetch and return HTML content", async () => {
    const mockHtml = "<html><body><h1>Test</h1></body></html>";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode(mockHtml).buffer,
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "html" },
      mockContext,
    );

    expect(result).toBe(mockHtml);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining("text/html"),
        }),
      }),
    );
  });

  it("should convert HTML to markdown", async () => {
    const mockHtml = "<html><body><h1>Title</h1><p>Content</p></body></html>";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode(mockHtml).buffer,
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "markdown" },
      mockContext,
    );

    expect(result).toContain("# Title");
    expect(result).toContain("Content");
  });

  it("should extract text from HTML", async () => {
    const mockHtml =
      "<html><body><h1>Title</h1><p>Content</p><script>alert('test')</script></body></html>";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode(mockHtml).buffer,
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "text" },
      mockContext,
    );

    expect(result).toContain("Title");
    expect(result).toContain("Content");
    expect(result).not.toContain("script");
    expect(result).not.toContain("alert");
  });

  it("should handle image responses", async () => {
    const mockImageBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/jpeg"]]),
      arrayBuffer: async () => mockImageBuffer.buffer,
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com/image.jpg", format: "markdown" },
      mockContext,
    );

    expect(result).toContain("Image fetched successfully");
    expect(mockContext.appendUserMessage).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image-url",
          url: expect.stringContaining("data:image/jpeg;base64,"),
        }),
      ]),
    );
  });

  it("should reject responses exceeding size limit", async () => {
    const largeContent = "x".repeat(6 * 1024 * 1024); // 6MB
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/plain"]]),
      arrayBuffer: async () => new TextEncoder().encode(largeContent).buffer,
    });

    await expect(
      webFetchTool.execute(
        { url: "https://example.com", format: "markdown" },
        mockContext,
      ),
    ).rejects.toThrow("Response too large");
  });

  it("should handle failed requests", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(
      webFetchTool.execute(
        { url: "https://example.com", format: "markdown" },
        mockContext,
      ),
    ).rejects.toThrow("Request failed with status code: 404 Not Found");
  });

  it("should retry with different User-Agent on Cloudflare challenge", async () => {
    const mockHtml = "<html><body>Success</body></html>";

    // First call returns Cloudflare challenge
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Map([["cf-mitigated", "challenge"]]),
      })
      // Second call succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/html"]]),
        arrayBuffer: async () => new TextEncoder().encode(mockHtml).buffer,
      });

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "markdown" },
      mockContext,
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "dyad-agent",
        }),
      }),
    );
    expect(result).toContain("Success");
  });

  it("should use custom timeout", async () => {
    const mockHtml = "<html><body>Test</body></html>";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode(mockHtml).buffer,
    });

    await webFetchTool.execute(
      { url: "https://example.com", format: "markdown", timeout: 60 },
      mockContext,
    );

    // Verify fetch was called with a signal
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("should respect max timeout limit", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const mockHtml = "<html><body>Test</body></html>";
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(mockHtml),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn(),
      releaseLock: vi.fn(),
    };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      body: { getReader: () => mockReader },
    });

    // Request 200 seconds but max is 120
    await webFetchTool.execute(
      { url: "https://example.com", format: "markdown", timeout: 200 },
      mockContext,
    );

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      120 * 1000,
    );
    vi.useRealTimers();
    setTimeoutSpy.mockRestore();
  });

  it("should block private/internal URLs (SSRF protection)", async () => {
    const privateUrls = [
      "http://localhost/secret",
      "http://127.0.0.1/admin",
      "http://0.0.0.0/",
      "http://10.0.0.1/internal",
      "http://172.16.0.1/data",
      "http://192.168.1.1/config",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "https://app.local/api",
    ];

    for (const url of privateUrls) {
      await expect(
        webFetchTool.execute({ url, format: "text" }, mockContext),
      ).rejects.toThrow(
        "Access to private/internal network addresses is not allowed",
      );
    }

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should strip encoded script tags to prevent XSS bypass", async () => {
    const mockHtml =
      "<html><body>Hello &lt;script&gt;alert('xss')&lt;/script&gt; World</body></html>";
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(mockHtml),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn(),
      releaseLock: vi.fn(),
    };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      body: { getReader: () => mockReader },
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com", format: "text" },
      mockContext,
    );

    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("should generate consent preview", () => {
    const preview = webFetchTool.getConsentPreview?.({
      url: "https://example.com",
      format: "markdown",
    });

    expect(preview).toBe('Fetch URL: "https://example.com" as markdown');
  });
});
