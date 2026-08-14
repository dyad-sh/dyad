import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Contracts for the stock image gallery.
 *
 * The search runs in the main process because the API key lives there. No
 * output schema carries the key: the renderer learns whether one is stored,
 * never what it is.
 */

export const StockImageSchema = z.object({
  id: z.number(),
  previewUrl: z.string(),
  imageUrl: z.string(),
  largeImageUrl: z.string(),
  width: z.number(),
  height: z.number(),
  tags: z.array(z.string()),
  author: z.string(),
  pageUrl: z.string(),
});

export type StockImageResult = z.infer<typeof StockImageSchema>;

export const stockImageContracts = {
  /** Whether a key is stored. Its value never leaves the main process. */
  authState: defineContract({
    channel: "stock-images:auth-state",
    input: z.void(),
    output: z.object({ hasKey: z.boolean() }),
  }),
  /** Remember a Pixabay key, encrypted. */
  saveApiKey: defineContract({
    channel: "stock-images:save-api-key",
    input: z.object({ apiKey: z.string().min(1) }),
    output: z.void(),
  }),
  /** Forget the stored key. */
  clearApiKey: defineContract({
    channel: "stock-images:clear-api-key",
    input: z.void(),
    output: z.void(),
  }),
  search: defineContract({
    channel: "stock-images:search",
    input: z.object({
      query: z.string().min(1).max(100),
      page: z.number().int().min(1).max(100).optional(),
      orientation: z.enum(["all", "horizontal", "vertical"]).optional(),
    }),
    output: z.object({
      /** Results this search can page through. */
      total: z.number(),
      /** Everything Pixabay holds for the query, most of it out of reach. */
      totalAvailable: z.number(),
      images: z.array(StockImageSchema),
    }),
  }),
} as const;

export const stockImageClient = createClient(stockImageContracts);
