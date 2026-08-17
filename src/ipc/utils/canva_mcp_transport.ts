import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { CANVA_MCP_SERVER_URL } from "@/lib/canvaMcp";

export function createCanvaMcpTransport(
  authProvider: OAuthClientProvider,
  headers?: HeadersInit,
) {
  return new StreamableHTTPClientTransport(new URL(CANVA_MCP_SERVER_URL), {
    authProvider,
    requestInit: {
      headers,
      redirect: "error",
    },
  });
}
