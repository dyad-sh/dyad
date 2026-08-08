import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import log from "electron-log";

import { LOVABLE_MCP_SERVER_URL } from "@/lib/lovableMcp";

const logger = log.scope("lovable_mcp_transport");

function requestUrl(input: RequestInfo | URL) {
  return new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
}

function isLovableMcpRequest(input: RequestInfo | URL) {
  const target = requestUrl(input);
  const server = new URL(LOVABLE_MCP_SERVER_URL);
  const normalizedPath = target.pathname.replace(/\/+$/, "") || "/";
  return (
    target.origin === server.origin &&
    (normalizedPath === "/" || normalizedPath === "/mcp")
  );
}

export function createLovableMcpFetch(
  fetchFn: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const method = init?.method?.toUpperCase() ?? "GET";
    const isMcpRequest = isLovableMcpRequest(input);
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });

    if (isMcpRequest && method === "POST") {
      headers.set("Accept", "application/json, text/event-stream");
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchFn(input, { ...init, headers });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      logger.debug("Lovable MCP session established", { sessionId });
    }
    const isExpectedUnsupportedSseGet =
      isMcpRequest && method === "GET" && response.status === 405;
    if (!response.ok && !isExpectedUnsupportedSseGet) {
      const rawBody = await response
        .clone()
        .text()
        .catch(() => "");
      logger.error("Lovable MCP request failed", {
        status: response.status,
        statusText: response.statusText,
        body: rawBody.slice(0, 2_000),
      });
    }
    return response;
  };
}

export function createLovableMcpTransport(
  authProvider: OAuthClientProvider,
  headers?: HeadersInit,
) {
  return new StreamableHTTPClientTransport(new URL(LOVABLE_MCP_SERVER_URL), {
    authProvider,
    fetch: createLovableMcpFetch(),
    requestInit: {
      headers,
      redirect: "error",
    },
  });
}
