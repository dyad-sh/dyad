import { isSupabaseConnected, type UserSettings } from "@/lib/schemas";

/**
 * What is currently connected to Meta Human OS.
 *
 * Read from the configuration each integration already keeps. Nothing is
 * listed as connected because it exists: a service appears here only when the
 * app holds something that proves a connection — a stored token, a saved
 * organisation, a configured provider.
 *
 * Services with nothing configured are not invented as rows either. The panel
 * answers "what is connected", so an empty answer is an empty panel.
 */

export type ConnectedService = {
  id: string;
  name: string;
  detail?: string;
  /** The existing screen that manages this connection. */
  to: string;
};

export function buildConnectedServices(input: {
  settings: UserSettings | null;
  /** AI providers with credentials, as the providers screen determines it. */
  providers: Array<{ id: string; name: string }>;
  /** Null while unknown, so nothing is claimed before it is known. */
  mcpServerCount: number | null;
  dataSourceCount: number | null;
}): ConnectedService[] {
  const { settings } = input;
  const services: ConnectedService[] = [];

  if (settings?.githubAccessToken) {
    services.push({ id: "github", name: "GitHub", to: "/github-manager" });
  }
  if (settings?.vercelAccessToken) {
    services.push({ id: "vercel", name: "Vercel", to: "/vercel-manager" });
  }
  if (isSupabaseConnected(settings)) {
    services.push({ id: "supabase", name: "Supabase", to: "/data-sources" });
  }
  if (settings?.neon?.accessToken) {
    services.push({ id: "neon", name: "Neon", to: "/data-sources" });
  }
  if (settings?.cloudflareApiToken) {
    services.push({
      id: "cloudflare",
      name: "Cloudflare",
      to: "/data-sources",
    });
  }
  if (settings?.pixabayApiKey) {
    services.push({ id: "pixabay", name: "Pixabay", to: "/library/stock" });
  }

  for (const provider of input.providers) {
    services.push({
      id: `provider:${provider.id}`,
      name: provider.name,
      detail: "AI provider",
      to: `/settings/providers/${provider.id}`,
    });
  }

  if (input.mcpServerCount && input.mcpServerCount > 0) {
    services.push({
      id: "mcp",
      name: "MCP servers",
      detail: `${input.mcpServerCount} configured`,
      to: "/settings",
    });
  }

  if (input.dataSourceCount && input.dataSourceCount > 0) {
    services.push({
      id: "data-sources",
      name: "Data sources",
      detail: `${input.dataSourceCount} configured`,
      to: "/data-sources",
    });
  }

  return services;
}
