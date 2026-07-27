import { z } from "zod";
import { ChatAttachmentShapeSchema, ComponentSelectionSchema } from "./chat";
import { ChatModeSchema } from "../../lib/schemas";

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
  redo: z.boolean().optional(),
  appId: z.number().int().positive().optional(),
  // `null` is an intentional skip-cache sentinel, distinct from omission.
  requestedChatMode: ChatModeSchema.nullable().optional(),
  // Read-only backward compatibility: renderer hydration discards legacy
  // machine-owned entries and no longer writes this owner-only marker.
  userInputRequestId: z.string().optional(),
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
