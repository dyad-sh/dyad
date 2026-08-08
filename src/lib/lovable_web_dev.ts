import type { Agent } from "@/pages/agent-os/data";
import { LOVABLE_MCP_SERVER_URL } from "./lovableMcp";

export const LOVABLE_WEB_DEV_AGENT_ID = "builtin-lovable-web-dev";

export const LOVABLE_WEB_DEV_AGENT: Agent = {
  id: LOVABLE_WEB_DEV_AGENT_ID,
  name: "Web Dev",
  description:
    "Build, inspect, iterate and publish websites through Lovable MCP.",
  type: "MCP",
  endpoint: LOVABLE_MCP_SERVER_URL,
  imageBaseUrl: "",
  model: "Lovable MCP",
  status: "offline",
  capabilities: ["projects", "code", "deployments", "analytics"],
  icon: "🌐",
  lastActivity: "Built in",
  taskCount: 0,
  enabled: true,
  hasApiKey: false,
};
