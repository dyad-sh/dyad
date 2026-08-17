export const CANVA_MCP_SERVER_URL = "https://mcp.canva.com/mcp";
export const CANVA_MCP_DOCS_URL = "https://www.canva.dev/docs/mcp/";
export const CANVA_ACCESS_URL = "https://www.canva.com/";
export const CANVA_OAUTH_REDIRECT_URL = "http://127.0.0.1:0/callback";

export function isCanvaMcpServerUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const expected = new URL(CANVA_MCP_SERVER_URL);
    return (
      parsed.protocol === expected.protocol &&
      parsed.hostname === expected.hostname &&
      parsed.port === expected.port &&
      parsed.pathname.replace(/\/+$/, "") ===
        expected.pathname.replace(/\/+$/, "")
    );
  } catch {
    return false;
  }
}

export function getEnabledCanvaMcpServerIds(
  servers: Array<{ id: number; url: string | null; enabled: boolean }>,
) {
  return servers
    .filter((server) => server.enabled && isCanvaMcpServerUrl(server.url))
    .map((server) => server.id);
}
