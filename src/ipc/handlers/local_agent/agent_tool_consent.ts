import { db } from "../../../db";
import { agentToolConsents } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";

export type Consent = "ask" | "always" | "denied";

export type AgentToolName =
  | "read_file"
  | "list_files"
  | "get_database_schema"
  | "write_file"
  | "delete_file"
  | "rename_file"
  | "search_replace"
  | "add_dependency"
  | "execute_sql"
  | "set_chat_summary";

// Default permissions for each tool
// Read-only tools default to "always", write tools default to "ask"
const DEFAULT_CONSENTS: Record<AgentToolName, Consent> = {
  read_file: "always",
  list_files: "always",
  get_database_schema: "always",
  write_file: "ask",
  delete_file: "ask",
  rename_file: "ask",
  search_replace: "ask",
  add_dependency: "ask",
  execute_sql: "ask",
  set_chat_summary: "always",
};

export const AGENT_TOOLS: {
  name: AgentToolName;
  description: string;
  category: "read" | "write";
}[] = [
  {
    name: "read_file",
    description: "Read file content from the codebase",
    category: "read",
  },
  {
    name: "list_files",
    description: "List all files in the app directory",
    category: "read",
  },
  {
    name: "get_database_schema",
    description: "Fetch database schema from Supabase",
    category: "read",
  },
  {
    name: "write_file",
    description: "Create or overwrite a file",
    category: "write",
  },
  {
    name: "delete_file",
    description: "Delete a file from the codebase",
    category: "write",
  },
  {
    name: "rename_file",
    description: "Rename or move a file",
    category: "write",
  },
  {
    name: "search_replace",
    description: "Apply targeted search/replace edits",
    category: "write",
  },
  {
    name: "add_dependency",
    description: "Install npm packages",
    category: "write",
  },
  {
    name: "execute_sql",
    description: "Execute SQL on Supabase database",
    category: "write",
  },
  {
    name: "set_chat_summary",
    description: "Set the chat title/summary",
    category: "read", // Cosmetic, no code impact
  },
];

const pendingConsentResolvers = new Map<
  string,
  (d: "accept-once" | "accept-always" | "decline") => void
>();

export function waitForAgentToolConsent(
  requestId: string,
): Promise<"accept-once" | "accept-always" | "decline"> {
  return new Promise((resolve) => {
    pendingConsentResolvers.set(requestId, resolve);
  });
}

export function resolveAgentToolConsent(
  requestId: string,
  decision: "accept-once" | "accept-always" | "decline",
) {
  const resolver = pendingConsentResolvers.get(requestId);
  if (resolver) {
    pendingConsentResolvers.delete(requestId);
    resolver(decision);
  }
}

export function getDefaultConsent(toolName: AgentToolName): Consent {
  return DEFAULT_CONSENTS[toolName] ?? "ask";
}

export async function getAgentToolConsent(
  toolName: AgentToolName,
): Promise<Consent> {
  const rows = await db
    .select()
    .from(agentToolConsents)
    .where(eq(agentToolConsents.toolName, toolName));

  if (rows.length === 0) {
    return getDefaultConsent(toolName);
  }
  return (rows[0].consent as Consent) ?? getDefaultConsent(toolName);
}

export async function setAgentToolConsent(
  toolName: AgentToolName,
  consent: Consent,
): Promise<void> {
  const rows = await db
    .select()
    .from(agentToolConsents)
    .where(eq(agentToolConsents.toolName, toolName));

  if (rows.length > 0) {
    await db
      .update(agentToolConsents)
      .set({ consent })
      .where(eq(agentToolConsents.toolName, toolName));
  } else {
    await db.insert(agentToolConsents).values({ toolName, consent });
  }
}

export async function getAllAgentToolConsents(): Promise<
  Record<AgentToolName, Consent>
> {
  const rows = await db.select().from(agentToolConsents);
  const result: Record<string, Consent> = {};

  // Start with defaults
  for (const tool of AGENT_TOOLS) {
    result[tool.name] = getDefaultConsent(tool.name);
  }

  // Override with stored values
  for (const row of rows) {
    if (row.toolName in result) {
      result[row.toolName] = row.consent as Consent;
    }
  }

  return result as Record<AgentToolName, Consent>;
}

export async function requireAgentToolConsent(
  event: IpcMainInvokeEvent,
  params: {
    toolName: AgentToolName;
    toolDescription?: string | null;
    inputPreview?: string | null;
  },
): Promise<boolean> {
  const current = await getAgentToolConsent(params.toolName);

  if (current === "always") return true;
  if (current === "denied") return false;

  // Ask renderer for a decision via event bridge
  const requestId = `agent:${params.toolName}:${Date.now()}`;
  (event.sender as any).send("agent-tool:consent-request", {
    requestId,
    ...params,
  });

  const response = await waitForAgentToolConsent(requestId);

  if (response === "accept-always") {
    await setAgentToolConsent(params.toolName, "always");
    return true;
  }
  if (response === "decline") {
    return false;
  }
  return response === "accept-once";
}
