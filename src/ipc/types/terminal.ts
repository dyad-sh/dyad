import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

// =============================================================================
// Terminal Schemas
// =============================================================================

export const TerminalSessionSchema = z.object({
  id: z.string(),
  appId: z.number(),
  cwd: z.string(),
  isRunning: z.boolean(),
});

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

export const TerminalOutputSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
  type: z.enum(["stdout", "stderr", "system"]),
});

export type TerminalOutput = z.infer<typeof TerminalOutputSchema>;

export const CreateTerminalSessionParamsSchema = z.object({
  appId: z.number(),
});

export const TerminalWriteParamsSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
});

export const TerminalResizeParamsSchema = z.object({
  sessionId: z.string(),
  cols: z.number(),
  rows: z.number(),
});

export const TerminalCloseParamsSchema = z.object({
  sessionId: z.string(),
});

export const TerminalSessionIdSchema = z.object({
  sessionId: z.string(),
});

// =============================================================================
// Terminal Contracts
// =============================================================================

export const terminalContracts = {
  createSession: defineContract({
    channel: "terminal:create-session",
    input: CreateTerminalSessionParamsSchema,
    output: TerminalSessionSchema,
  }),

  write: defineContract({
    channel: "terminal:write",
    input: TerminalWriteParamsSchema,
    output: z.void(),
  }),

  resize: defineContract({
    channel: "terminal:resize",
    input: TerminalResizeParamsSchema,
    output: z.void(),
  }),

  close: defineContract({
    channel: "terminal:close",
    input: TerminalCloseParamsSchema,
    output: z.void(),
  }),

  getSession: defineContract({
    channel: "terminal:get-session",
    input: TerminalSessionIdSchema,
    output: TerminalSessionSchema.nullable(),
  }),
} as const;

// =============================================================================
// Terminal Event Contracts
// =============================================================================

export const terminalEvents = {
  output: defineEvent({
    channel: "terminal:output",
    payload: TerminalOutputSchema,
  }),

  sessionClosed: defineEvent({
    channel: "terminal:session-closed",
    payload: TerminalSessionIdSchema,
  }),
} as const;

// =============================================================================
// Terminal Clients
// =============================================================================

export const terminalClient = createClient(terminalContracts);
export const terminalEventClient = createEventClient(terminalEvents);
