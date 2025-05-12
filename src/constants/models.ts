import type { ModelProvider } from "@/lib/schemas";
export interface ModelOption {
  name: string;
  displayName: string;
  description: string;
  tag?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
}

export type RegularModelProvider = Exclude<
  ModelProvider,
  "ollama" | "lmstudio"
>;
export const MODEL_OPTIONS: Record<RegularModelProvider, ModelOption[]> = {
  openai: [
    // https://platform.openai.com/docs/models/gpt-4.1
    {
      name: "gpt-4.1",
      displayName: "GPT 4.1",
      description: "OpenAI's flagship model",
      maxOutputTokens: 32_768,
      contextWindow: 1_047_576,
    },
    // https://platform.openai.com/docs/models/gpt-4.1-mini
    {
      name: "gpt-4.1-mini",
      displayName: "GPT 4.1 Mini",
      description: "OpenAI's lightweight, but intelligent model",
      maxOutputTokens: 32_768,
      contextWindow: 1_047_576,
    },
    // https://platform.openai.com/docs/models/o3-mini
    {
      name: "o3-mini",
      displayName: "o3 mini",
      description: "Reasoning model",
      maxOutputTokens: 100_000,
      contextWindow: 200_000,
    },
  ],
  // https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
  anthropic: [
    {
      name: "claude-3-7-sonnet-latest",
      displayName: "Claude 3.7 Sonnet",
      description: "Excellent coder",
      maxOutputTokens: 64_000,
      contextWindow: 200_000,
    },
  ],
  google: [
    // https://ai.google.dev/gemini-api/docs/models#gemini-2.5-pro-preview-03-25
    {
      name: "gemini-2.5-pro-exp-03-25",
      displayName: "Gemini 2.5 Pro",
      description: "Experimental version of Google's Gemini 2.5 Pro model",
      tag: "Recommended",
      // See Flash 2.5 comment below (go 1 below just to be safe, even though it seems OK now).
      maxOutputTokens: 65_536 - 1,
      // Gemini context window = input token + output token
      contextWindow: 1_048_576,
    },
    // https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-preview
    {
      name: "gemini-2.5-flash-preview-04-17",
      displayName: "Gemini 2.5 Flash",
      description: "Preview version of Google's Gemini 2.5 Flash model",
      // Weirdly for Vertex AI, the output token limit is *exclusive* of the stated limit.
      maxOutputTokens: 65_536 - 1,
      // Gemini context window = input token + output token
      contextWindow: 1_048_576,
    },
  ],
  openrouter: [
    // https://openrouter.ai/deepseek/deepseek-chat-v3-0324:free
    {
      name: "deepseek/deepseek-chat-v3-0324:free",
      displayName: "DeepSeek v3 (free)",
      description: "Use for free (data may be used for training)",
      maxOutputTokens: 32_000,
      contextWindow: 128_000,
    },
  ],
  auto: [
    {
      name: "auto",
      displayName: "Auto",
      description: "Automatically selects the best model",
      tag: "Default",
    },
  ],
};

export const AUTO_MODELS = [
  {
    provider: "google",
    name: "gemini-2.5-pro-exp-03-25",
  },
  {
    provider: "anthropic",
    name: "claude-3-7-sonnet-latest",
  },
  {
    provider: "openai",
    name: "gpt-4.1",
  },
];
