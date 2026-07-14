import { z } from "zod";
import {
  defineContract,
  defineSendContract,
  createClient,
  createSendClient,
} from "../contracts/core";
import { ChatAttachmentShapeSchema, ComponentSelectionSchema } from "./chat";

// =============================================================================
// Queued Prompts Persistence Contracts
// =============================================================================

/**
 * A single persisted queued prompt. Mirrors the in-memory QueuedMessageItem
 * (src/atoms/chatAtoms.ts) but uses the serializable ChatAttachment shape
 * (base64) instead of the renderer FileAttachment (which holds a browser File
 * object and cannot be JSON-serialized).
 *
 * Attachments use ChatAttachmentShapeSchema (shape only, no size-limit
 * refinement): sizes were already validated at the original submission
 * boundary, so re-checking on every persist/hydrate round-trip wastes CPU and
 * could silently drop previously valid queued prompts if limits are tightened.
 */
export const PersistedQueuedMessageSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  attachments: z.array(ChatAttachmentShapeSchema).optional(),
  selectedComponents: z.array(ComponentSelectionSchema).optional(),
});

export type PersistedQueuedMessage = z.infer<
  typeof PersistedQueuedMessageSchema
>;

/**
 * The full persisted queue, keyed by chatId (as a string, since JSON object
 * keys are always strings). Converted to/from Map<number, ...> at the atom
 * boundary in the renderer.
 */
export const PersistedQueueSchema = z.record(
  // Canonical decimal chat IDs only: without this, "01" and "1" would both
  // resolve to the same numeric chat ID and silently overwrite each other's
  // persisted file. `String(chatId)` always produces the canonical form.
  z.string().regex(/^(0|[1-9]\d*)$/),
  z.array(PersistedQueuedMessageSchema),
);

export type PersistedQueue = z.infer<typeof PersistedQueueSchema>;

export const queueContracts = {
  /**
   * Get the persisted queued prompts for all chats. Prunes entries whose chat
   * no longer exists before returning.
   */
  getQueuedPrompts: defineContract({
    channel: "get-queued-prompts",
    input: z.void(),
    output: PersistedQueueSchema,
  }),
} as const;

export const queueSendContracts = {
  /**
   * Replace the persisted queued prompts for all chats.
   *
   * Deliberately a one-way (fire-and-forget) send rather than an `invoke`: the
   * renderer flushes the queue from its `pagehide` handler as the window is
   * being destroyed on app quit. A two-way `invoke` would leave the main
   * process replying to an already-destroyed frame, which Electron throws as
   * "Object has been destroyed". A one-way send has no reply to deliver back.
   */
  setQueuedPrompts: defineSendContract({
    channel: "set-queued-prompts",
    input: PersistedQueueSchema,
  }),
} as const;

// =============================================================================
// Queue Client
// =============================================================================

/**
 * Type-safe client for queued-prompt persistence.
 *
 * @example
 * const queued = await queueClient.getQueuedPrompts();
 * queueClient.setQueuedPrompts(queued); // one-way, returns void
 */
export const queueClient = {
  ...createClient(queueContracts),
  ...createSendClient(queueSendContracts),
};
