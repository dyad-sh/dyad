/**
 * Centralized API Key Resolver
 *
 * Resolution order:
 *   1. Secrets Vault (by provider tag, e.g. "openai")
 *   2. User Settings (providerSettings.<provider>.apiKey)
 *   3. Environment variable (process.env.<ENV_VAR>)
 *
 * This module runs in the **main process** only.
 */

import { getSecretsVault, type Secret } from "./secrets_vault";
import { readSettings } from "../main/settings";
import log from "electron-log";

const logger = log.scope("api-key-resolver");

// =============================================================================
// PROVIDER REGISTRY — known services + their .env var names
// =============================================================================

export interface ProviderTemplate {
  /** Internal identifier used as the vault tag and settings key */
  id: string;
  /** Human-readable name shown in the UI */
  label: string;
  /** Short description for non-technical users */
  description: string;
  /** URL where users can create/find the key */
  helpUrl: string;
  /** Corresponding process.env variable name */
  envVar: string;
  /** Vault secret category */
  category: "ai" | "cloud" | "database" | "service" | "personal" | "other";
  /** Icon hint for the UI */
  icon: string;
  /** Placeholder showing key format */
  placeholder: string;
}

export const PROVIDER_REGISTRY: ProviderTemplate[] = [
  // ── AI Providers ───────────────────────────────────────────────────────────
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4, DALL·E, Whisper and more",
    helpUrl: "https://platform.openai.com/api-keys",
    envVar: "OPENAI_API_KEY",
    category: "ai",
    icon: "🤖",
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models for chat and code",
    helpUrl: "https://console.anthropic.com/settings/keys",
    envVar: "ANTHROPIC_API_KEY",
    category: "ai",
    icon: "🧠",
    placeholder: "sk-ant-...",
  },
  {
    id: "google",
    label: "Google AI (Gemini)",
    description: "Gemini models and Google AI Studio",
    helpUrl: "https://aistudio.google.com/app/apikey",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    category: "ai",
    icon: "💎",
    placeholder: "AIza...",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    description: "Mistral, Mixtral and Codestral models",
    helpUrl: "https://console.mistral.ai/api-keys",
    envVar: "MISTRAL_API_KEY",
    category: "ai",
    icon: "🌪️",
    placeholder: "...",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Ultra-fast LLM inference",
    helpUrl: "https://console.groq.com/keys",
    envVar: "GROQ_API_KEY",
    category: "ai",
    icon: "⚡",
    placeholder: "gsk_...",
  },
  {
    id: "together",
    label: "Together AI",
    description: "Open-source model hosting",
    helpUrl: "https://api.together.xyz/settings/api-keys",
    envVar: "TOGETHER_API_KEY",
    category: "ai",
    icon: "🤝",
    placeholder: "...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Unified API for 100+ models",
    helpUrl: "https://openrouter.ai/keys",
    envVar: "OPENROUTER_API_KEY",
    category: "ai",
    icon: "🔀",
    placeholder: "sk-or-...",
  },
  {
    id: "replicate",
    label: "Replicate",
    description: "Run open-source ML models",
    helpUrl: "https://replicate.com/account/api-tokens",
    envVar: "REPLICATE_API_TOKEN",
    category: "ai",
    icon: "🔁",
    placeholder: "r8_...",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    description: "Model hub and inference API",
    helpUrl: "https://huggingface.co/settings/tokens",
    envVar: "HUGGINGFACE_TOKEN",
    category: "ai",
    icon: "🤗",
    placeholder: "hf_...",
  },
  {
    id: "stabilityai",
    label: "Stability AI",
    description: "Stable Diffusion image generation",
    helpUrl: "https://platform.stability.ai/account/keys",
    envVar: "STABILITY_API_KEY",
    category: "ai",
    icon: "🎨",
    placeholder: "sk-...",
  },
  {
    id: "fal",
    label: "fal.ai",
    description: "Fast media generation APIs",
    helpUrl: "https://fal.ai/dashboard/keys",
    envVar: "FAL_KEY",
    category: "ai",
    icon: "🖼️",
    placeholder: "...",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "AI voice synthesis and cloning",
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
    envVar: "ELEVENLABS_API_KEY",
    category: "ai",
    icon: "🔊",
    placeholder: "...",
  },

  // ── Cloud / Service Providers ──────────────────────────────────────────────
  {
    id: "github",
    label: "GitHub",
    description: "Personal access token for repos & APIs",
    helpUrl: "https://github.com/settings/tokens",
    envVar: "GITHUB_ACCESS_TOKEN",
    category: "service",
    icon: "🐙",
    placeholder: "ghp_...",
  },
  {
    id: "vercel",
    label: "Vercel",
    description: "Deploy and host web applications",
    helpUrl: "https://vercel.com/account/tokens",
    envVar: "VERCEL_ACCESS_TOKEN",
    category: "cloud",
    icon: "▲",
    placeholder: "...",
  },
  {
    id: "supabase",
    label: "Supabase",
    description: "Postgres database and auth platform",
    helpUrl: "https://supabase.com/dashboard/account/tokens",
    envVar: "SUPABASE_ACCESS_TOKEN",
    category: "cloud",
    icon: "⚡",
    placeholder: "sbp_...",
  },
  {
    id: "aws",
    label: "AWS",
    description: "Amazon Web Services access key",
    helpUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    envVar: "AWS_ACCESS_KEY_ID",
    category: "cloud",
    icon: "☁️",
    placeholder: "AKIA...",
  },
  {
    id: "stripe",
    label: "Stripe",
    description: "Payment processing API",
    helpUrl: "https://dashboard.stripe.com/apikeys",
    envVar: "STRIPE_SECRET_KEY",
    category: "service",
    icon: "💳",
    placeholder: "sk_...",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    description: "Email delivery service",
    helpUrl: "https://app.sendgrid.com/settings/api_keys",
    envVar: "SENDGRID_API_KEY",
    category: "service",
    icon: "📧",
    placeholder: "SG...",
  },
  {
    id: "runway",
    label: "Runway ML",
    description: "AI video generation",
    helpUrl: "https://app.runwayml.com/account/api-keys",
    envVar: "RUNWAY_API_KEY",
    category: "ai",
    icon: "🎬",
    placeholder: "...",
  },
];

// Fast lookup map: provider id → template
const providerMap = new Map(PROVIDER_REGISTRY.map((p) => [p.id, p]));

export function getProviderTemplate(providerId: string): ProviderTemplate | undefined {
  return providerMap.get(providerId);
}

// =============================================================================
// RESOLVER
// =============================================================================

export interface ResolvedKey {
  value: string;
  source: "vault" | "settings" | "env";
  providerId: string;
}

/**
 * Resolve an API key for a known provider.
 *
 * 1. Secrets Vault — looks for an `api_key` secret tagged with the provider id
 * 2. User Settings — reads `providerSettings[providerId].apiKey`
 * 3. Environment — reads `process.env[envVar]`
 */
export async function resolveApiKey(providerId: string): Promise<ResolvedKey | null> {
  const template = providerMap.get(providerId);

  // ── 1. Secrets Vault ────────────────────────────────────────────────────
  try {
    const vault = getSecretsVault();
    if (!vault.isVaultLocked() && vault.hasVault()) {
      const secrets = await vault.listSecrets({ type: "api_key", tags: [providerId] });
      if (secrets.length > 0) {
        const full = await vault.getSecret(secrets[0].id);
        if (full?.value) {
          return { value: full.value, source: "vault", providerId };
        }
      }
    }
  } catch (err) {
    logger.warn(`Vault lookup failed for ${providerId}:`, err);
  }

  // ── 2. User Settings ───────────────────────────────────────────────────
  try {
    const settings = readSettings();
    const provKey = settings.providerSettings[providerId]?.apiKey?.value;
    if (provKey) {
      return { value: provKey, source: "settings", providerId };
    }
    // Check special top-level tokens
    if (providerId === "github" && settings.githubAccessToken?.value) {
      return { value: settings.githubAccessToken.value, source: "settings", providerId };
    }
    if (providerId === "huggingface" && settings.huggingFaceToken?.value) {
      return { value: settings.huggingFaceToken.value, source: "settings", providerId };
    }
    if (providerId === "vercel" && settings.vercelAccessToken?.value) {
      return { value: settings.vercelAccessToken.value, source: "settings", providerId };
    }
  } catch (err) {
    logger.warn(`Settings lookup failed for ${providerId}:`, err);
  }

  // ── 3. Environment variable ─────────────────────────────────────────────
  if (template?.envVar) {
    const envVal = process.env[template.envVar];
    if (envVal) {
      return { value: envVal, source: "env", providerId };
    }
  }

  return null;
}

// =============================================================================
// PROVIDER STATUS (for the UI)
// =============================================================================

export interface ProviderKeyStatus {
  providerId: string;
  label: string;
  icon: string;
  description: string;
  helpUrl: string;
  category: string;
  configured: boolean;
  source: "vault" | "settings" | "env" | "none";
  /** True if the key lives in the encrypted vault */
  vaultProtected: boolean;
  /** Masked preview like "sk-...abc" */
  maskedKey: string | null;
}

function maskKey(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Returns the configuration status of every known provider.
 */
export async function getAllProviderStatus(): Promise<ProviderKeyStatus[]> {
  const results: ProviderKeyStatus[] = [];

  for (const tmpl of PROVIDER_REGISTRY) {
    const resolved = await resolveApiKey(tmpl.id);
    results.push({
      providerId: tmpl.id,
      label: tmpl.label,
      icon: tmpl.icon,
      description: tmpl.description,
      helpUrl: tmpl.helpUrl,
      category: tmpl.category,
      configured: resolved !== null,
      source: resolved?.source ?? "none",
      vaultProtected: resolved?.source === "vault",
      maskedKey: resolved ? maskKey(resolved.value) : null,
    });
  }

  return results;
}
