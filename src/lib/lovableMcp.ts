export const LOVABLE_MCP_SERVER_URL = "https://mcp.lovable.dev";
export const LOVABLE_MCP_DOCS_URL =
  "https://docs.lovable.dev/integrations/lovable-mcp-server";
export const LOVABLE_MCP_ACCESS_URL = "https://lovable.dev";
export const LOVABLE_SUPPORT_URL = "https://lovable.dev/support";
export const LOVABLE_MCP_OAUTH_SUPPORTED = true;
export const LOVABLE_OAUTH_PUBLIC_CLIENT_ID =
  "6d465f583e1e4ce5801b1616f735670c";
export const LOVABLE_OAUTH_REDIRECT_URL = "http://127.0.0.1:0/callback";
export const LOVABLE_OAUTH_CUSTOM_REDIRECT_URL = "metahumanos://oauth/callback";
export const LOVABLE_OAUTH_SCOPE =
  "offline workspaces:read workspaces:write projects:read projects:write projects:create openid email profile";

export function isLovableMcpServerUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const expected = new URL(LOVABLE_MCP_SERVER_URL);
    const path = parsed.pathname.replace(/\/+$/, "");
    return (
      parsed.protocol === expected.protocol &&
      parsed.hostname === expected.hostname &&
      parsed.port === expected.port &&
      (path === expected.pathname.replace(/\/+$/, "") || path === "/mcp")
    );
  } catch {
    return false;
  }
}

export function getEnabledLovableMcpServerIds(
  servers: Array<{ id: number; url: string | null; enabled: boolean }>,
) {
  return servers
    .filter((server) => server.enabled && isLovableMcpServerUrl(server.url))
    .map((server) => server.id);
}
