import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const MAX_TERMINAL_WRITE_LENGTH = 1_048_576;

export const TerminalOpenParamsSchema = z.object({
  appId: z.number(),
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200),
});

export const TerminalSessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export const TerminalWriteParamsSchema = TerminalSessionParamsSchema.extend({
  data: z.string().max(MAX_TERMINAL_WRITE_LENGTH),
});

export const TerminalResizeParamsSchema = TerminalSessionParamsSchema.extend({
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200),
});

export const TerminalExitPayloadSchema = z.object({
  sessionId: z.string(),
  exitCode: z.number().nullable(),
  signal: z.number().nullable().optional(),
});

export const TerminalDataPayloadSchema = z.object({
  sessionId: z.string(),
  chunk: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
});

export const TerminalOpenResultSchema = z.object({
  sessionId: z.string(),
  shell: z.string(),
  cwd: z.string(),
  appName: z.string(),
  scrollback: z.string(),
  created: z.boolean(),
  exited: TerminalExitPayloadSchema.omit({ sessionId: true }).optional(),
  evicted: z
    .object({
      appId: z.number(),
      appName: z.string(),
    })
    .optional(),
});

export type TerminalOpenParams = z.infer<typeof TerminalOpenParamsSchema>;
export type TerminalOpenResult = z.infer<typeof TerminalOpenResultSchema>;
export type TerminalDataPayload = z.infer<typeof TerminalDataPayloadSchema>;
export type TerminalExitPayload = z.infer<typeof TerminalExitPayloadSchema>;

export const terminalContracts = {
  open: defineContract({
    channel: "terminal:open",
    input: TerminalOpenParamsSchema,
    output: TerminalOpenResultSchema,
  }),

  close: defineContract({
    channel: "terminal:close",
    input: TerminalSessionParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  kill: defineContract({
    channel: "terminal:kill",
    input: TerminalSessionParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  write: defineContract({
    channel: "terminal:write",
    input: TerminalWriteParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  resize: defineContract({
    channel: "terminal:resize",
    input: TerminalResizeParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  serialize: defineContract({
    channel: "terminal:serialize",
    input: TerminalSessionParamsSchema,
    output: z.object({
      scrollback: z.string(),
      scrollbackEndOffset: z.number().int().nonnegative(),
    }),
  }),
} as const;

export const terminalClient = createClient(terminalContracts);
