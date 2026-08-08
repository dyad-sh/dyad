import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Document text extraction through the model assigned to the OCR role.
 *
 * Attached PDFs and images are turned into text before the chat model sees
 * them, so "read this invoice" works instead of the model apologising that it
 * cannot open files.
 */

export const ExtractDocumentTextParamsSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  /** File contents, base64 without a data-URL prefix. */
  dataBase64: z.string(),
});
export type ExtractDocumentTextParams = z.infer<
  typeof ExtractDocumentTextParamsSchema
>;

export const ExtractDocumentTextResponseSchema = z.object({
  text: z.string(),
  /** Model that performed the extraction. */
  model: z.string(),
});
export type ExtractDocumentTextResponse = z.infer<
  typeof ExtractDocumentTextResponseSchema
>;

export const ocrContracts = {
  extractDocumentText: defineContract({
    channel: "ocr:extract-document-text",
    input: ExtractDocumentTextParamsSchema,
    output: ExtractDocumentTextResponseSchema,
  }),
};

export const ocrClient = createClient(ocrContracts);
