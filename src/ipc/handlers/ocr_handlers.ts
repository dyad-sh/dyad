import log from "electron-log";

import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAssignedModelForRole } from "@/lib/model_roles";
import { createTypedHandler } from "./base";
import { getEnvVar } from "../utils/read_env";
import { resolveProviderModelsEndpoint } from "../utils/provider_api_models";
import { PROVIDER_TO_ENV_VAR } from "../shared/language_model_constants";
import { ocrContracts } from "../types/ocr";
import { saveOcrDocumentToVault } from "../utils/knowledge_base";

const logger = log.scope("ocr_handlers");

const OCR_TIMEOUT_MS = 120_000;

const OCR_PROMPT = [
  "Extract all text from this document exactly as written. Preserve the",
  "reading order, headings, tables (as markdown tables) and numbers.",
  // Page markers survive into the index, which is what lets a citation name
  // a page instead of only a line range in a flattened blob.
  "Begin each page with a line of exactly this form, and nothing else on it:",
  "[[page N]]",
  "where N is that page's number in the document. Output only the extracted",
  "content with no commentary.",
].join(" ");

/**
 * Where to send the document: whichever provider holds the OCR-role model.
 *
 * Every provider here speaks the OpenAI chat-completions shape, so one request
 * body works for all of them — the provider only determines the endpoint and
 * key. Restricting this to a single vendor would have made the feature useless
 * to anyone whose vision model lives elsewhere.
 */
function resolveOcrTarget(): {
  model: string;
  baseUrl: string;
  apiKey?: string;
  providerId: string;
} {
  const settings = readSettings();
  const assigned = getAssignedModelForRole(settings, "ocr");
  if (!assigned) {
    throw new DyadError(
      "No OCR model is assigned. Choose a vision model under Settings → Model Roles → OCR, then attach the file again.",
      DyadErrorKind.Precondition,
    );
  }

  let baseUrl: string;
  let apiKey: string | undefined;
  try {
    ({ baseUrl, apiKey } = resolveProviderModelsEndpoint(
      assigned.provider,
      settings,
    ));
  } catch {
    throw new DyadError(
      `Document reading is not supported for the ${assigned.provider} provider. Assign the OCR role to a vision model on a provider with an HTTP endpoint.`,
      DyadErrorKind.Precondition,
    );
  }

  // Local servers (Ollama, LM Studio) legitimately have no key.
  const needsKey = !/localhost|127\.0\.0\.1/.test(baseUrl);
  if (needsKey && !apiKey) {
    apiKey =
      getEnvVar(PROVIDER_TO_ENV_VAR[assigned.provider] ?? "") || undefined;
  }
  if (needsKey && !apiKey) {
    throw new DyadError(
      `${assigned.provider} has no API key configured — add one in Settings → Providers.`,
      DyadErrorKind.Precondition,
    );
  }

  return {
    model: assigned.name,
    baseUrl,
    apiKey,
    providerId: assigned.provider,
  };
}

/**
 * Extracts a document's text using the OCR-role model.
 *
 * Shared by the chat attachment path and the vector indexer, so a PDF reads
 * the same way wherever it enters the app.
 */
export async function extractDocumentText(
  params: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
  },
  options?: {
    timeoutMs?: number;
  },
): Promise<{ text: string; model: string }> {
  const { model, baseUrl, apiKey, providerId } = resolveOcrTarget();

  const isImage = params.mimeType.startsWith("image/");
  const dataUrl = `data:${params.mimeType};base64,${params.dataBase64}`;
  const filePart = isImage
    ? { type: "image_url", image_url: { url: dataUrl } }
    : { type: "file", file: { filename: params.fileName, file_data: dataUrl } };

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? OCR_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "X-Title": "Meta Human OS OCR",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: OCR_PROMPT }, filePart],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DyadError(
        `Document reading timed out after ${Math.max(1, Math.round(timeoutMs / 60_000))} minute${timeoutMs >= 90_000 ? "s" : ""}.`,
        DyadErrorKind.External,
      );
    }
    throw new DyadError(
      `Could not reach ${providerId} for document reading.`,
      DyadErrorKind.External,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: unknown } };
      if (typeof body?.error?.message === "string") {
        detail = `: ${body.error.message.slice(0, 200)}`;
      }
    } catch {
      // Never echo a raw body; it may quote the request back.
    }
    logger.error(`OCR request failed: HTTP ${response.status}`);
    throw new DyadError(
      isImage
        ? `Document reading failed (HTTP ${response.status})${detail}`
        : `Document reading failed (HTTP ${response.status})${detail}. Not every provider accepts PDF input — if this keeps happening, assign the OCR role to a model that does, or attach the page as an image.`,
      DyadErrorKind.External,
    );
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof (part as { text?: unknown })?.text === "string"
                ? (part as { text: string }).text
                : "",
            )
            .join("")
            .trim()
        : "";

  if (!text) {
    throw new DyadError(
      `The OCR model returned no text for ${params.fileName}. It may not support this file type.`,
      DyadErrorKind.External,
    );
  }

  logger.log(
    `Extracted ${text.length} characters from ${params.fileName} via ${model}`,
  );
  return { text, model };
}

export function registerOcrHandlers() {
  createTypedHandler(ocrContracts.extractDocumentText, async (_, params) => {
    const result = await extractDocumentText(params);

    // File the document into the vault and index it, so a document read once
    // in chat stays searchable. Never fail the read over a storage problem.
    try {
      const saved = await saveOcrDocumentToVault({
        fileName: params.fileName,
        dataBase64: params.dataBase64,
        text: result.text,
        model: result.model,
      });
      if (saved) {
        logger.log(`Filed ${params.fileName} into the vault Documents folder`);
      }
    } catch (error) {
      logger.warn(
        `Could not file ${params.fileName} into the vault: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    return result;
  });
}
