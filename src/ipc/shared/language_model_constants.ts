export const PROVIDERS_THAT_SUPPORT_THINKING: (keyof typeof MODEL_OPTIONS)[] = [
  "google",
  "vertex",
];

export interface ModelOption {
  name: string;
  displayName: string;
  description: string;
  dollarSigns?: number;
  temperature?: number;
  tag?: string;
  tagColor?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
}

export const GPT_5_2_MODEL_NAME = "gpt-5.2";
export const SONNET_4_6 = "claude-sonnet-4-6";
export const OPUS_4_6 = "claude-opus-4-6";
export const GEMINI_3_FLASH = "gemini-3-flash-preview";
export const GEMINI_3_1_PRO_PREVIEW = "gemini-3.1-pro-preview";
export const GPT_5_NANO = "gpt-5-nano";

export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  openai: [
    // https://platform.openai.com/docs/models/gpt-5.1
    {
      name: GPT_5_2_MODEL_NAME,
      displayName: "GPT 5.2",
      description: "OpenAI's latest model",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 3,
    },
    // https://platform.openai.com/docs/models/gpt-5.1
    {
      name: "gpt-5.1",
      displayName: "GPT 5.1",
      description:
        "OpenAI's flagship model- smarter, faster, and more conversational",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 3,
    },
    // https://platform.openai.com/docs/models/gpt-5.1-codex
    {
      name: "gpt-5.1-codex",
      displayName: "GPT 5.1 Codex",
      description: "OpenAI's advanced coding workflows",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 3,
    },
    // https://platform.openai.com/docs/models/gpt-5.1-codex-mini
    {
      name: "gpt-5.1-codex-mini",
      displayName: "GPT 5.1 Codex Mini",
      description: "OpenAI's compact and efficient coding model",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 2,
    },

    // https://platform.openai.com/docs/models/gpt-5
    {
      name: "gpt-5",
      displayName: "GPT 5",
      description: "OpenAI's flagship model",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 3,
    },
    // https://platform.openai.com/docs/models/gpt-5-codex
    {
      name: "gpt-5-codex",
      displayName: "GPT 5 Codex",
      description: "OpenAI's flagship model optimized for coding",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 3,
    },
    // https://platform.openai.com/docs/models/gpt-5-mini
    {
      name: "gpt-5-mini",
      displayName: "GPT 5 Mini",
      description: "OpenAI's lightweight, but intelligent model",
      // Technically it's 128k but OpenAI errors if you set max_tokens instead of max_completion_tokens
      maxOutputTokens: undefined,
      contextWindow: 400_000,
      // Requires temperature to be default value (1)
      temperature: 1,
      dollarSigns: 2,
    },
  ],
  // https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
  anthropic: [
    {
      name: "claude-opus-4-6",
      displayName: "Claude Opus 4.6",
      description:
        "Anthropic's best model for coding (note: this model is very expensive!)",
      // Set to 32k since context window is 1M tokens
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
      temperature: 0,
      dollarSigns: 6,
    },
    // https://docs.anthropic.com/en/docs/about-claude/models/overview
    {
      name: SONNET_4_6,
      displayName: "Claude Sonnet 4.6",
      description:
        "Anthropic's fast and intelligent model (note: >200k tokens is very expensive!)",
      // Set to 32k since context window is 1M tokens
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
      temperature: 0,
      dollarSigns: 5,
    },
    {
      name: "claude-opus-4-5",
      displayName: "Claude Opus 4.5",
      description:
        "Anthropic's best model for coding (note: this model is very expensive!)",
      // Set to 32k since context window is 1M tokens
      maxOutputTokens: 32_000,
      contextWindow: 200_000,
      temperature: 0,
      dollarSigns: 5,
    },
    {
      name: "claude-sonnet-4-5-20250929",
      displayName: "Claude Sonnet 4.5",
      description:
        "Anthropic's best model for coding (note: >200k tokens is very expensive!)",
      // Set to 32k since context window is 1M tokens
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
      temperature: 0,
      dollarSigns: 5,
    },
    {
      name: "claude-sonnet-4-20250514",
      displayName: "Claude Sonnet 4",
      description: "Excellent coder (note: >200k tokens is very expensive!)",
      // Set to 32k since context window is 1M tokens
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
      temperature: 0,
      dollarSigns: 5,
    },
  ],
  google: [
    // https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview
    {
      name: "gemini-3.1-pro-preview",
      displayName: "Gemini 3.1 Pro (Preview)",
      description: "Google's most capable Gemini model",
      // See Flash 2.5 comment below (go 1 below just to be safe, even though it seems OK now).
      maxOutputTokens: 65_536 - 1,
      // Gemini context window = input token + output token
      contextWindow: 1_048_576,
      // Recommended by Google: https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#temperature
      temperature: 1.0,
      dollarSigns: 4,
    },
    // https://ai.google.dev/gemini-api/docs/models#gemini-3-pro
    {
      name: GEMINI_3_FLASH,
      displayName: "Gemini 3 Flash (Preview)",
      description: "Powerful coding model at a good price",
      // See Flash 2.5 comment below (go 1 below just to be safe, even though it seems OK now).
      maxOutputTokens: 65_536 - 1,
      // Gemini context window = input token + output token
      contextWindow: 1_048_576,
      // Recommended by Google: https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#temperature
      temperature: 1.0,
      dollarSigns: 2,
    },
    // https://ai.google.dev/gemini-api/docs/models#gemini-2.5-pro-preview-03-25
    {
      name: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      description: "Google's Gemini 2.5 Pro model",
      // See Flash 2.5 comment below (go 1 below just to be safe, even though it seems OK now).
      maxOutputTokens: 65_536 - 1,
      // Gemini context window = input token + output token
      contextWindow: 1_048_576,
      temperature: 0,
      dollarSigns: 3,
    },
    // https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-preview
    {
      name: "gemini-flash-latest",
      displayName: "Gemini 2.5 Flash",
      description: "Google's Gemini 2.5 Flash model (free tier available)",
      // Weirdly for Vertex AI, the output token limit is *exclusive* of the stated limit.
      maxOutputTokens: 65_536 - 1,
      // Gemini context window = input token + output token
      contextWindow: 1_048_576,
      temperature: 0,
      dollarSigns: 2,
    },
  ],
  vertex: [
    // Vertex Gemini 2.5 Pro
    {
      name: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      description: "Vertex Gemini 2.5 Pro",
      maxOutputTokens: 65_536 - 1,
      contextWindow: 1_048_576,
      temperature: 0,
    },
    // Vertex Gemini 2.5 Flash
    {
      name: "gemini-flash-latest",
      displayName: "Gemini 2.5 Flash",
      description: "Vertex Gemini 2.5 Flash",
      maxOutputTokens: 65_536 - 1,
      contextWindow: 1_048_576,
      temperature: 0,
    },
  ],
  vercel: [
    {
      name: "openai/gpt-5.4",
      displayName: "GPT 5.4",
      description: "OpenAI GPT 5.4 through Vercel AI Gateway",
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
    },
    {
      name: "anthropic/claude-sonnet-4.6",
      displayName: "Claude Sonnet 4.6",
      description: "Anthropic Claude Sonnet 4.6 through Vercel AI Gateway",
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
    },
    {
      name: "google/gemini-3-flash",
      displayName: "Gemini 3 Flash",
      description: "Google Gemini 3 Flash through Vercel AI Gateway",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
    },
  ],
  // https://www.kimi.com/code/docs/en/kimi-code/models.html
  "kimi-code": [
    {
      name: "k3",
      displayName: "Kimi K3",
      description:
        "Kimi's flagship coding model for large codebases and multi-file work",
      contextWindow: 1_048_576,
      dollarSigns: 2,
    },
    {
      name: "k3-256k",
      displayName: "Kimi K3 256K",
      description: "Kimi K3 for everyday coding with lower quota consumption",
      contextWindow: 256_000,
      dollarSigns: 1,
    },
    {
      name: "kimi-for-coding",
      displayName: "Kimi K2.7 Code",
      description: "Kimi's coding model for completion and routine development",
      contextWindow: 256_000,
      dollarSigns: 1,
    },
    {
      name: "kimi-for-coding-highspeed",
      displayName: "Kimi K2.7 Code HighSpeed",
      description: "Kimi K2.7 Code with substantially faster model output",
      contextWindow: 256_000,
      dollarSigns: 2,
    },
  ],
  openrouter: [
    {
      name: "openrouter/free",
      displayName: "Free (OpenRouter)",
      description:
        "Uses one of the free OpenRouter models (data may be used for training)",
      maxOutputTokens: 32_000,
      contextWindow: 200_000,
      temperature: 0,
      dollarSigns: 0,
    },
    // https://openrouter.ai/moonshotai/kimi-k2.5
    {
      name: "moonshotai/kimi-k2.5",
      displayName: "Kimi K2.5",
      description: "Moonshot AI's latest and most capable model",
      maxOutputTokens: 32_000,
      contextWindow: 256_000,
      temperature: 1.0,
      dollarSigns: 2,
    },
    // https://openrouter.ai/minimax/minimax-m2.7
    {
      name: "minimax/minimax-m2.7",
      displayName: "MiniMax M2.7",
      description: "Latest flagship model with enhanced reasoning and coding",
      maxOutputTokens: 32_000,
      contextWindow: 204_800,
      temperature: 0,
      dollarSigns: 1,
    },
    // https://openrouter.ai/minimax/minimax-m2.5
    {
      name: "minimax/minimax-m2.5",
      displayName: "MiniMax M2.5",
      description: "Strong cost-effective model for real-world productivity",
      maxOutputTokens: 32_000,
      contextWindow: 196_608,
      temperature: 0,
      dollarSigns: 1,
    },
    {
      name: "z-ai/glm-5",
      displayName: "GLM 5",
      description: "Z-AI's best coding model",
      maxOutputTokens: 32_000,
      contextWindow: 200_000,
      temperature: 0.7,
      dollarSigns: 2,
    },
    {
      name: "z-ai/glm-4.7",
      displayName: "GLM 4.7",
      description: "Z-AI's coding model",
      maxOutputTokens: 32_000,
      contextWindow: 200_000,
      temperature: 0.7,
      dollarSigns: 2,
    },
    {
      name: "qwen/qwen3-coder",
      displayName: "Qwen3 Coder",
      description: "Qwen's best coding model",
      maxOutputTokens: 32_000,
      contextWindow: 262_000,
      temperature: 0,
      dollarSigns: 2,
    },
    {
      name: "deepseek/deepseek-chat-v3.1",
      displayName: "DeepSeek v3.1",
      description: "Strong cost-effective model with optional thinking",
      maxOutputTokens: 32_000,
      contextWindow: 128_000,
      temperature: 0,
      dollarSigns: 2,
    },
  ],
  auto: [
    {
      name: "auto",
      displayName: "Auto",
      description: "Automatically selects the best model",
      tag: "Default",
      tagColor: "bg-primary text-primary-foreground",
      // The following is reasonable defaults.
      maxOutputTokens: 32_000,
      contextWindow: 200_000,
      temperature: 0,
    },
    {
      name: "free",
      displayName: "Free (OpenRouter)",
      description: "Selects from one of the free OpenRouter models",
      tag: "Free",
      tagColor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      // These are below Gemini 2.5 Pro & Flash limits
      // which are the ones defaulted to for both regular auto
      // and smart auto.
      maxOutputTokens: 32_000,
      contextWindow: 128_000,
      temperature: 0,
    },
    {
      name: "value",
      displayName: "Super Value",
      description: "Uses the most cost-effective models available",
      maxOutputTokens: 32_000,
      contextWindow: 256_000,
      temperature: 0,
      tag: "Budget",
      tagColor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    },
  ],
  azure: [
    {
      name: "gpt-5.1",
      displayName: "GPT-5.1",
      description: "Azure OpenAI GPT-5.1 model",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5.1-codex",
      displayName: "GPT-5.1 Codex",
      description: "Azure OpenAI GPT-5.1 Codex model",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5.1-codex-mini",
      displayName: "GPT-5.1 Codex Mini",
      description: "Azure OpenAI GPT-5.1 Codex Mini model",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5-codex",
      displayName: "GPT-5 Codex",
      description: "Azure OpenAI GPT-5 Codex model",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5",
      displayName: "GPT-5",
      description: "Azure OpenAI GPT-5 model with reasoning capabilities",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5-mini",
      displayName: "GPT-5 Mini",
      description: "Azure OpenAI GPT-5 Mini model",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5-nano",
      displayName: "GPT-5 Nano",
      description: "Azure OpenAI GPT-5 Nano model",
      // See OpenAI comment above
      // maxOutputTokens: 128_000,
      contextWindow: 400_000,
      temperature: 1,
    },
    {
      name: "gpt-5-chat",
      displayName: "GPT-5 Chat",
      description: "Azure OpenAI GPT-5 Chat model",
      // See OpenAI comment above
      // maxOutputTokens: 16_384,
      contextWindow: 128_000,
      temperature: 1,
    },
  ],
  xai: [
    // https://docs.x.ai/docs/models
    {
      name: "grok-code-fast-1",
      displayName: "Grok Code Fast",
      description: "Fast coding model",
      maxOutputTokens: 32_000,
      contextWindow: 256_000,
      temperature: 0,
      dollarSigns: 1,
    },
    {
      name: "grok-4",
      displayName: "Grok 4",
      description: "Most capable coding model",
      maxOutputTokens: 32_000,
      contextWindow: 256_000,
      temperature: 0,
      dollarSigns: 4,
    },
    {
      name: "grok-3",
      displayName: "Grok 3",
      description: "Powerful coding model",
      maxOutputTokens: 32_000,
      contextWindow: 131_072,
      temperature: 0,
      dollarSigns: 4,
    },
  ],
  bedrock: [
    {
      name: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      displayName: "Claude 4.5 Sonnet",
      description:
        "Anthropic's best model for coding (note: >200k tokens is very expensive!)",
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
      temperature: 0,
    },
    {
      name: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      displayName: "Claude 4 Sonnet",
      description: "Excellent coder (note: >200k tokens is very expensive!)",
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
      temperature: 0,
    },
  ],
  // https://platform.minimax.io/docs/api-reference/text-anthropic-api
  minimax: [
    {
      name: "MiniMax-M2.7",
      displayName: "MiniMax M2.7",
      description: "Latest flagship model with enhanced reasoning and coding",
      maxOutputTokens: 32_000,
      contextWindow: 204_800,
      temperature: 1.0,
      dollarSigns: 1,
    },
    {
      name: "MiniMax-M2.7-highspeed",
      displayName: "MiniMax M2.7 High Speed",
      description: "High-speed version of M2.7 for low-latency scenarios",
      maxOutputTokens: 32_000,
      contextWindow: 204_800,
      temperature: 1.0,
      dollarSigns: 1,
    },
    {
      name: "MiniMax-M2.5",
      displayName: "MiniMax M2.5",
      description: "Peak Performance. Ultimate Value. Master the Complex",
      maxOutputTokens: 32_000,
      contextWindow: 204_800,
      temperature: 1.0,
      dollarSigns: 1,
    },
    {
      name: "MiniMax-M2.5-highspeed",
      displayName: "MiniMax M2.5 High Speed",
      description: "Same performance, faster and more agile",
      maxOutputTokens: 32_000,
      contextWindow: 204_800,
      temperature: 1.0,
      dollarSigns: 1,
    },
  ],
  phantom: [
    {
      name: "kimi-k2.6",
      displayName: "Kimi K2.6",
      description: "Hermes / Phantom default model",
      maxOutputTokens: 8192,
      contextWindow: 128_000,
      temperature: 0.7,
    },
  ],
  // Video models. These are not chat models: they are listed so the Video
  // model role has something to choose from, and every one is a fal endpoint.
  fal: [
    {
      name: "fal-ai/kling-video/v1/standard/text-to-video",
      displayName: "Kling 1.0 (video)",
      description: "Default text-to-video model. Smooth motion, 10s clips.",
      dollarSigns: 2,
    },
    {
      name: "fal-ai/kling-video/v1/standard/image-to-video",
      displayName: "Kling 1.0 Image-to-Video",
      description: "Animates a still image into a 10s clip.",
      dollarSigns: 2,
    },
    {
      name: "fal-ai/luma-dream-machine",
      displayName: "Luma Dream Machine (video)",
      description: "Cinematic text-to-video with strong camera movement.",
      dollarSigns: 2,
    },
    {
      name: "fal-ai/minimax/video-01",
      displayName: "MiniMax Video 01 (video)",
      description: "Text-to-video with detailed scene composition.",
      dollarSigns: 2,
    },
  ],
};

export const FREE_OPENROUTER_MODEL_NAMES = MODEL_OPTIONS.openrouter
  .filter(
    (model) => model.name.endsWith(":free") || model.name.endsWith("/free"),
  )
  .map((model) => model.name);

export const PROVIDER_TO_ENV_VAR: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  vercel: "AI_GATEWAY_API_KEY",
  "kimi-code": "KIMI_API_KEY",
  azure: "AZURE_API_KEY",
  xai: "XAI_API_KEY",
  bedrock: "AWS_BEARER_TOKEN_BEDROCK",
  minimax: "MINIMAX_API_KEY",
  phantom: "HERMES_API_KEY",
  fal: "FAL_KEY",
};

export const CLOUD_PROVIDERS: Record<
  string,
  {
    displayName: string;
    hasFreeTier?: boolean;
    websiteUrl?: string;
    gatewayPrefix?: string;
    secondary?: boolean;
    /**
     * Set for providers whose models are not conversational. They stay out of
     * the chat model picker and are offered only for the roles they can serve.
     */
    nonChat?: boolean;
  }
> = {
  openai: {
    displayName: "OpenAI",
    hasFreeTier: false,
    websiteUrl: "https://platform.openai.com/api-keys",
    gatewayPrefix: "",
  },
  anthropic: {
    displayName: "Anthropic",
    hasFreeTier: false,
    websiteUrl: "https://console.anthropic.com/settings/keys",
    gatewayPrefix: "anthropic/",
  },
  google: {
    displayName: "Google",
    hasFreeTier: true,
    websiteUrl: "https://aistudio.google.com/app/apikey",
    gatewayPrefix: "gemini/",
  },
  vertex: {
    displayName: "Google Vertex AI",
    hasFreeTier: false,
    websiteUrl: "https://console.cloud.google.com/vertex-ai",
    // Use the same gateway prefix as Google Gemini for Meta Human OS Pro compatibility.
    gatewayPrefix: "gemini/",
    secondary: true,
  },
  openrouter: {
    displayName: "OpenRouter",
    hasFreeTier: true,
    websiteUrl: "https://openrouter.ai/settings/keys",
    gatewayPrefix: "openrouter/",
  },
  vercel: {
    displayName: "Vercel AI Gateway",
    hasFreeTier: false,
    websiteUrl: "https://vercel.com/ai-gateway",
  },
  "kimi-code": {
    displayName: "Kimi Code",
    hasFreeTier: false,
    websiteUrl: "https://www.kimi.com/code/console",
  },
  auto: {
    displayName: "Meta Human OS",
    websiteUrl: "https://academy.dyad.sh/subscription",
    gatewayPrefix: "dyad/",
  },
  azure: {
    displayName: "Azure OpenAI",
    hasFreeTier: false,
    websiteUrl: "https://portal.azure.com/",
    gatewayPrefix: "",
    secondary: true,
  },
  xai: {
    displayName: "xAI",
    hasFreeTier: false,
    websiteUrl: "https://console.x.ai/",
    gatewayPrefix: "xai/",
    secondary: true,
  },
  bedrock: {
    displayName: "AWS Bedrock",
    hasFreeTier: false,
    websiteUrl: "https://console.aws.amazon.com/bedrock/",
    gatewayPrefix: "bedrock/",
    secondary: true,
  },
  minimax: {
    displayName: "MiniMax",
    hasFreeTier: false,
    websiteUrl: "https://platform.minimax.io/",
    gatewayPrefix: "minimax/",
    secondary: true,
  },
  phantom: {
    displayName: "Phantom (Hermes)",
    hasFreeTier: false,
    websiteUrl: "http://192.168.68.111:8642/",
    gatewayPrefix: "phantom/",
    secondary: true,
  },
  fal: {
    displayName: "fal.ai",
    hasFreeTier: false,
    websiteUrl: "https://fal.ai/dashboard/keys",
    secondary: true,
    // Video only — Kling is not something you hold a conversation with.
    nonChat: true,
  },
};

export const LOCAL_PROVIDERS: Record<
  string,
  {
    displayName: string;
    hasFreeTier: boolean;
    websiteUrl?: string;
  }
> = {
  ollama: {
    displayName: "Ollama",
    hasFreeTier: true,
    websiteUrl: "https://ollama.com/",
  },
  lmstudio: {
    displayName: "LM Studio",
    hasFreeTier: true,
    websiteUrl: "https://lmstudio.ai/",
  },
  mx_serve: {
    displayName: "MX Serve",
    hasFreeTier: true,
  },
};
