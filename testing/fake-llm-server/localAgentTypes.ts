/**
 * TypeScript types for the Local Agent E2E testing DSL
 */

export type AgentToolName =
  | "write_file"
  | "read_file"
  | "search_replace"
  | "delete_file"
  | "rename_file"
  | "list_files"
  | "add_dependency"
  | "execute_sql"
  | "get_database_schema"
  | "set_chat_summary";

export type ToolCall = {
  /** The name of the tool to call */
  name: AgentToolName;
  /** Arguments to pass to the tool */
  args: Record<string, unknown>;
};

export type Turn = {
  /** Optional text content to output before tool calls */
  text?: string;
  /** Tool calls to execute in this turn */
  toolCalls?: ToolCall[];
  /** Text to output after tool results are received (final turn only) */
  textAfterTools?: string;
};

export type LocalAgentFixture = {
  /** Description for debugging */
  description?: string;
  /** Ordered turns in the conversation */
  turns: Turn[];
};
