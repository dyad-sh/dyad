/**
 * TypeScript types for the Local Agent E2E testing DSL
 */

export type ToolCall = {
  /** The name of the tool to call */
  name: string;
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
  /** Optional usage data to include in the final streaming chunk (for testing token-based features like compaction) */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * Represents a single outer loop pass.
 * The outer loop runs when todos are incomplete after a chat response.
 */
export type Pass = {
  /** Ordered turns within this pass */
  turns: Turn[];
};

export type LocalAgentFixture = {
  /** Description for debugging */
  description?: string;
  /**
   * Ordered turns in the conversation.
   * For simple fixtures without outer loop testing.
   */
  turns?: Turn[];
  /**
   * Ordered passes for testing outer loop behavior.
   * Each pass contains turns that execute within that outer loop iteration.
   * Use this when testing todo follow-up loop behavior.
   */
  passes?: Pass[];
};
