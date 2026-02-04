import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Autocomplete Schemas
// =============================================================================

export const AutocompleteRequestSchema = z.object({
  inputText: z.string(),
  chatId: z.number().optional(),
  appId: z.number().optional(),
  requestId: z.string(),
});

export type AutocompleteRequest = z.infer<typeof AutocompleteRequestSchema>;

export const AutocompleteResponseSchema = z.object({
  suggestion: z.string(),
  variantId: z.string(),
  requestId: z.string(),
});

export type AutocompleteResponse = z.infer<typeof AutocompleteResponseSchema>;

// =============================================================================
// Autocomplete Contracts
// =============================================================================

export const autocompleteContracts = {
  getSuggestion: defineContract({
    channel: "chat:autocomplete",
    input: AutocompleteRequestSchema,
    output: AutocompleteResponseSchema,
  }),

  cancelSuggestion: defineContract({
    channel: "chat:autocomplete:cancel",
    input: z.string(), // requestId
    output: z.boolean(),
  }),
} as const;

// =============================================================================
// Autocomplete Client
// =============================================================================

export const autocompleteClient = createClient(autocompleteContracts);
