import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DEFAULT_PHANTOM_MODEL,
  normalizePhantomHermesApiBase,
} from "@/lib/ai_coder";
import { readSettings } from "../../main/settings";

async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

export async function testPhantomHermesConnection(
  apiKey: string,
  model: string,
  endpoint?: string,
): Promise<string> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new DyadError("Hermes API key is required", DyadErrorKind.Validation);
  }

  const modelName = model.trim() || DEFAULT_PHANTOM_MODEL;
  const completionsUrl = `${normalizePhantomHermesApiBase(endpoint ?? "")}/chat/completions`;
  const response = await postJson(completionsUrl, trimmedKey, {
    model: modelName,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 8,
    stream: false,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new DyadError(
      `Hermes connection failed (${response.status}): ${detail || response.statusText}`,
      DyadErrorKind.External,
    );
  }

  return `Connected to Hermes (${modelName})`;
}

export async function testOpenAiCoderConnection(
  apiKey: string | undefined,
  model: string,
): Promise<string> {
  const settings = readSettings();
  const resolvedKey =
    apiKey?.trim() ||
    settings.providerSettings?.openai?.apiKey?.value?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!resolvedKey) {
    throw new DyadError("OpenAI API key is required", DyadErrorKind.Validation);
  }

  const modelName = model.trim() || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new DyadError(
      `OpenAI connection failed (${response.status}): ${detail || response.statusText}`,
      DyadErrorKind.External,
    );
  }

  return `Connected to OpenAI (${modelName})`;
}
