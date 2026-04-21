const MODULE_SCRIPT_SRC_RE =
  /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/gi;

export const PREVIEW_MODULE_REQUEST_HEADERS = {
  Accept: "*/*",
  "Sec-Fetch-Dest": "script",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
} as const;

export function extractModuleScriptUrls(
  html: string,
  pageUrl: string,
): string[] {
  const urls = new Set<string>();

  for (const match of html.matchAll(MODULE_SCRIPT_SRC_RE)) {
    const src = match[1];
    if (!src) {
      continue;
    }

    try {
      urls.add(new URL(src, pageUrl).toString());
    } catch {
      continue;
    }
  }

  return [...urls];
}

export function isHtmlContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes("text/html") ?? false;
}

export async function waitForPreviewReady(
  pageUrl: string,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const intervalMs = options?.intervalMs ?? 250;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "Preview server did not become ready.";

  while (Date.now() < deadline) {
    try {
      const pageResponse = await fetchImpl(pageUrl, {
        cache: "no-store",
        headers: {
          Accept: "text/html",
        },
      });

      if (!pageResponse.ok) {
        lastFailure = `Preview root returned ${pageResponse.status}.`;
      } else {
        const pageContentType = pageResponse.headers.get("content-type");
        if (!isHtmlContentType(pageContentType)) {
          lastFailure = `Preview root returned unexpected content type ${
            pageContentType ?? "<missing>"
          }.`;
        } else {
          const html = await pageResponse.text();
          const moduleUrls = extractModuleScriptUrls(html, pageUrl);

          if (moduleUrls.length === 0) {
            return;
          }

          const moduleChecks = await Promise.all(
            moduleUrls.slice(0, 3).map(async (moduleUrl) => {
              const response = await fetchImpl(moduleUrl, {
                cache: "no-store",
                headers: PREVIEW_MODULE_REQUEST_HEADERS,
              });

              return {
                url: moduleUrl,
                ok: response.ok,
                status: response.status,
                contentType: response.headers.get("content-type"),
              };
            }),
          );

          const badModule = moduleChecks.find(
            (check) => !check.ok || isHtmlContentType(check.contentType),
          );

          if (!badModule) {
            return;
          }

          lastFailure = !badModule.ok
            ? `Module ${badModule.url} returned ${badModule.status}.`
            : `Module ${badModule.url} returned HTML instead of JavaScript (${
                badModule.contentType ?? "<missing>"
              }).`;
        }
      }
    } catch (error) {
      lastFailure =
        error instanceof Error
          ? error.message
          : `Unknown error: ${String(error)}`;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(lastFailure);
}
