import type { ModelProvider } from "@/lib/schemas";
export interface ModelOption {
  name: string;
  displayName: string;
  description: string;
  tag?: string;
}

type RegularModelProvider = Exclude<ModelProvider, "ollama">;
export const MODEL_OPTIONS: Record<RegularModelProvider, ModelOption[]> = {
  openai: [
    {
      name: "gpt-4.1",
      displayName: "GPT 4.1",
      description: "OpenAI's flagship model",
    },
    {
      name: "o3-mini",
      displayName: "o3 mini",
      description: "Reasoning model",
    },
  ],
  anthropic: [
    {
      name: "claude-3-7-sonnet-latest",
      displayName: "Claude 3.7 Sonnet",
      description: "Excellent coder",
    },
  ],
  google: [
    {
      name: "gemini-2.5-pro-exp-03-25",
      displayName: "Gemini 2.5 Pro",
      description: "Experimental version of Google's Gemini 2.5 Pro model",
      tag: "Recommended",
    },
  ],
  openrouter: [
    {
      name: "deepseek/deepseek-chat-v3-0324:free",
      displayName: "DeepSeek v3 (free)",
      description: "Use for free (data may be used for training)",
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

export const PROVIDERS: Record<
  RegularModelProvider,
  {
    name: string;
    displayName: string;
    hasFreeTier?: boolean;
    websiteUrl?: string;
  }
> = {
  openai: {
    name: "openai",
    displayName: "OpenAI",
    hasFreeTier: false,
    websiteUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic",
    hasFreeTier: false,
    websiteUrl: "https://console.anthropic.com/settings/keys",
  },
  google: {
    name: "google",
    displayName: "Google",
    hasFreeTier: true,
    websiteUrl: "https://aistudio.google.com/app/apikey",
  },
  openrouter: {
    name: "openrouter",
    displayName: "OpenRouter",
    hasFreeTier: true,
    websiteUrl: "https://openrouter.ai/settings/keys",
  },
  auto: {
    name: "auto",
    displayName: "Dyad",
    websiteUrl: "https://academy.dyad.sh/settings",
  },
};

export const PROVIDER_TO_ENV_VAR: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
};

export const ALLOWED_ENV_VARS = Object.keys(PROVIDER_TO_ENV_VAR).map(
  (provider) => PROVIDER_TO_ENV_VAR[provider]
);

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
