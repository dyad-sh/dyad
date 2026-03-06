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
  /**
   * For testing connection resilience: drop the connection on these attempt
   * numbers (1-indexed) for the first turn. The fake server will stream partial
   * data then destroy the socket, simulating a network interruption.
   * E.g., [1] means drop on the 1st attempt, succeed on the 2nd.
   */
  dropConnectionOnAttempts?: number[];
  /**
   * Optional per-turn connection drop configuration.
   * Useful for simulating drops after prior tool activity within the same turn.
   * Example: [{ turnIndex: 1, attempts: [1] }] drops the first attempt of turn 1.
   */
  dropConnectionByTurn?: Array<{
    /** 0-based turn index within the active pass */
    turnIndex: number;
    /** Attempt numbers (1-indexed) to drop for this turn */
    attempts: number[];
  }>;
  /**
   * Optional per-turn configuration to drop the connection AFTER streaming
   * tool-call chunks for a turn (before [DONE]). This simulates termination in
   * the window where a tool call was emitted but no tool result was captured.
   */
  dropConnectionAfterToolCallByTurn?: Array<{
    /** 0-based turn index within the active pass */
    turnIndex: number;
    /** Attempt numbers (1-indexed) to drop for this turn */
    attempts: number[];
  }>;
};
