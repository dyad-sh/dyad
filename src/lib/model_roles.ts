import type { LanguageModel } from "@/ipc/types";
import type { ModelRole, UserSettings } from "@/lib/schemas";

export const MODEL_ROLES: readonly ModelRole[] = [
  "chat",
  "image",
  "coding",
  "video",
  "embeddings",
  "ocr",
];

export type ModelCapability =
  | "Text"
  | "Vision"
  | "Image Generation"
  | "Video"
  | "Tool Calling"
  | "Coding"
  | "Embeddings"
  | "OCR"
  | "Reasoning"
  | "Local"
  | "Cloud";

export type RoleModelOption = {
  provider: string;
  providerName: string;
  name: string;
  displayName: string;
  description?: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
  local: boolean;
  latencyMs?: number;
  serverUrl?: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
};

export const MODEL_ROLE_META: Record<
  ModelRole,
  {
    label: string;
    description: string;
    requiredCapability: ModelCapability;
  }
> = {
  chat: {
    label: "Chat",
    description: "Conversation, questions, and tool-assisted tasks.",
    requiredCapability: "Text",
  },
  image: {
    label: "Image Generation",
    description: "Create and edit images from prompts.",
    requiredCapability: "Image Generation",
  },
  coding: {
    label: "Coding",
    description: "Plan, write, review, and debug code.",
    requiredCapability: "Coding",
  },
  video: {
    label: "Video Generation",
    description: "Generate video clips from text or images.",
    requiredCapability: "Video",
  },
  embeddings: {
    label: "Embeddings",
    description: "Vector search, retrieval, and semantic matching.",
    requiredCapability: "Embeddings",
  },
  ocr: {
    label: "OCR",
    description: "Read text and structured content from images.",
    requiredCapability: "OCR",
  },
};

const EMBEDDING_PATTERN = /\b(embed|embedding|bge-|e5-|gte-|nomic-embed)\b/i;
const IMAGE_PATTERN =
  /\b(flux|stable[- ]?diffusion|imagen|image[- ]generation|dall-?e|nano banana)\b/i;
const VIDEO_PATTERN = /\b(video|kling|luma|runway|wan[- ]?\d|minimax video)\b/i;
const VISION_PATTERN =
  /\b(vision|vlm|llava|pixtral|qwen[^ ]*[- ]vl|gemma[- ]?3|gpt-4o|gpt-5|claude|gemini)\b/i;
const CODING_PATTERN =
  /\b(code|coder|codex|deepseek|qwen|claude|gpt-4|gpt-5|gemini)\b/i;
const REASONING_PATTERN = /\b(reason|thinking|deepseek-r1|qwq|o1|o3|o4|r1)\b/i;

function searchableText(
  model: Pick<RoleModelOption, "name" | "displayName" | "description">,
) {
  return `${model.name} ${model.displayName} ${model.description ?? ""}`;
}

export function inferModelCapabilities(
  model: Pick<
    RoleModelOption,
    "provider" | "name" | "displayName" | "description" | "local"
  >,
): ModelCapability[] {
  const text = searchableText(model);
  const capabilities = new Set<ModelCapability>([
    model.local ? "Local" : "Cloud",
  ]);

  if (VIDEO_PATTERN.test(text) || model.provider === "fal") {
    capabilities.add("Video");
    return [...capabilities];
  }
  if (IMAGE_PATTERN.test(text)) {
    capabilities.add("Image Generation");
    return [...capabilities];
  }
  if (EMBEDDING_PATTERN.test(text)) {
    capabilities.add("Embeddings");
    return [...capabilities];
  }

  capabilities.add("Text");
  if (VISION_PATTERN.test(text)) {
    capabilities.add("Vision");
    capabilities.add("OCR");
  }
  if (CODING_PATTERN.test(text)) capabilities.add("Coding");
  if (REASONING_PATTERN.test(text)) capabilities.add("Reasoning");
  if (!model.local) capabilities.add("Tool Calling");
  return [...capabilities];
}

export function createRoleModelOption({
  provider,
  providerName,
  model,
  local,
}: {
  provider: string;
  providerName: string;
  model: LanguageModel;
  local: boolean;
}): RoleModelOption {
  const base = {
    provider,
    providerName,
    name: model.apiName,
    displayName: model.displayName,
    description: model.description,
    contextWindow: model.contextWindow,
    local,
  };
  return { ...base, capabilities: inferModelCapabilities(base) };
}

export function isModelSuitableForRole(
  model: RoleModelOption,
  role: ModelRole,
): boolean {
  const required = MODEL_ROLE_META[role].requiredCapability;
  return model.capabilities.includes(required);
}

/**
 * Roles whose picker is limited to models we judge capable.
 *
 * Only video. Its providers are a separate set from the language-model ones,
 * and a video role pointed at a chat model produces nothing at all.
 *
 * Everywhere else the capability is inferred from a regex over the model name,
 * which is a reasonable hint and a bad gate: it was hiding entire providers
 * from the image and embeddings pickers because nothing they offer happens to
 * match the pattern. The inference still orders and labels the list, it just no
 * longer decides what may be chosen.
 */
export const CAPABILITY_GATED_ROLES: readonly ModelRole[] = ["video"];

export function isRoleCapabilityGated(role: ModelRole): boolean {
  return CAPABILITY_GATED_ROLES.includes(role);
}

/**
 * What the picker offers for a role: every active provider's models, with the
 * ones inferred capable first, except where the role is gated.
 */
export function selectableModelsForRole(
  models: RoleModelOption[],
  role: ModelRole,
): RoleModelOption[] {
  if (isRoleCapabilityGated(role)) return filterModelsForRole(models, role);
  return [...models].sort((a, b) => {
    const capable =
      Number(isModelSuitableForRole(b, role)) -
      Number(isModelSuitableForRole(a, role));
    if (capable !== 0) return capable;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function filterModelsForRole(
  models: RoleModelOption[],
  role: ModelRole,
): RoleModelOption[] {
  return models.filter((model) => isModelSuitableForRole(model, role));
}

function modelScore(model: RoleModelOption, role: ModelRole): number {
  let score = 0;
  if (model.local) score += 18;
  if (model.capabilities.includes("Reasoning")) score += 8;
  if (model.capabilities.includes("Tool Calling") && role === "chat")
    score += 8;
  if (model.contextWindow) {
    score += Math.min(12, Math.log2(Math.max(1, model.contextWindow / 4_096)));
  }
  if (model.latencyMs !== undefined) {
    score += Math.max(0, 10 - model.latencyMs / 100);
  }

  const text = searchableText(model);
  if (role === "coding" && /\b(coder|codex|code)\b/i.test(text)) score += 30;
  if (role === "ocr" && /\b(ocr|vision|vlm)\b/i.test(text)) score += 24;
  if (role === "embeddings" && /\b(embed|embedding)\b/i.test(text)) score += 24;
  return score;
}

export function selectBestModelForRole(
  models: RoleModelOption[],
  role: ModelRole,
): RoleModelOption | undefined {
  return filterModelsForRole(models, role)
    .map((model, index) => ({ model, index, score: modelScore(model, role) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.model;
}

export function modelOptionKey(
  model: Pick<RoleModelOption, "provider" | "name">,
) {
  return `${model.provider}:${model.name}`;
}

export function getAssignedModelForRole(
  settings: UserSettings,
  role: ModelRole,
) {
  return settings.modelRoles?.[role]?.model;
}
