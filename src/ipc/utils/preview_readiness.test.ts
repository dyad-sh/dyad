import { describe, expect, it, vi } from "vitest";

import {
  PREVIEW_MODULE_REQUEST_HEADERS,
  extractModuleScriptUrls,
  isHtmlContentType,
  waitForPreviewReady,
} from "./preview_readiness";

describe("extractModuleScriptUrls", () => {
  it("resolves module script src values against the page URL", () => {
    const html = `<!doctype html>
<html>
  <head>
    <script type="module" src="/src/main.tsx"></script>
    <script type="module" src="./nested/entry.ts"></script>
  </head>
</html>`;

    expect(
      extractModuleScriptUrls(html, "http://localhost:3000/about"),
    ).toEqual([
      "http://localhost:3000/src/main.tsx",
      "http://localhost:3000/nested/entry.ts",
    ]);
  });
});

describe("isHtmlContentType", () => {
  it("detects HTML responses", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/javascript")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });
});

describe("waitForPreviewReady", () => {
  it("waits until the module entry stops returning HTML", async () => {
    let pageRequests = 0;
    let moduleRequests = 0;

    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/src/main.tsx")) {
        moduleRequests += 1;
        return new Response("export default {}", {
          status: 200,
          headers: {
            "content-type":
              moduleRequests === 1
                ? "text/html; charset=utf-8"
                : "application/javascript",
          },
        });
      }

      pageRequests += 1;
      return new Response(
        `<!doctype html><html><body><script type="module" src="/src/main.tsx"></script></body></html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }) as typeof fetch;

    await expect(
      waitForPreviewReady("http://localhost:3000", {
        fetchImpl,
        timeoutMs: 1_000,
        intervalMs: 0,
      }),
    ).resolves.toBeUndefined();

    expect(pageRequests).toBeGreaterThanOrEqual(2);
    expect(moduleRequests).toBeGreaterThanOrEqual(2);
  });

  it("fails when the module entry keeps returning HTML", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/src/main.tsx")) {
        return new Response("<html>fallback</html>", {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        });
      }

      return new Response(
        `<!doctype html><html><body><script type="module" src="/src/main.tsx"></script></body></html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }) as typeof fetch;

    await expect(
      waitForPreviewReady("http://localhost:3000", {
        fetchImpl,
        timeoutMs: 20,
        intervalMs: 0,
      }),
    ).rejects.toThrow(/returned HTML instead of JavaScript/);
  });

  it("probes module URLs with browser-like script headers", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/src/main.tsx")) {
        return new Response("export default {}", {
          status: 200,
          headers: {
            "content-type": "application/javascript",
          },
        });
      }

      return new Response(
        `<!doctype html><html><body><script type="module" src="/src/main.tsx"></script></body></html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }) as typeof fetch;

    await waitForPreviewReady("http://localhost:3000", {
      fetchImpl,
      timeoutMs: 1_000,
      intervalMs: 0,
    });

    const moduleCall = vi
      .mocked(fetchImpl)
      .mock.calls.find(([input]) => String(input).endsWith("/src/main.tsx"));

    expect(moduleCall?.[1]?.headers).toEqual(PREVIEW_MODULE_REQUEST_HEADERS);
  });
});
