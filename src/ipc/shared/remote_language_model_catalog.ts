import log from "electron-log";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  LanguageModel,
  LanguageModelProvider,
} from "@/ipc/types/language-model";
import {
  ThemeGenerationModelOptionSchema,
  type ThemeGenerationModelOption,
} from "@/ipc/types/templates";
import {
  CLOUD_PROVIDERS,
  GEMINI_3_1_PRO_PREVIEW,
  GPT_5_2_MODEL_NAME,
  GPT_5_NANO,
  MODEL_OPTIONS,
  OPUS_4_6,
  PROVIDER_TO_ENV_VAR,
  SONNET_4_6,
  GEMINI_3_FLASH,
} from "./language_model_constants";

const logger = log.scope("remote_language_model_catalog");

const REMOTE_LANGUAGE_MODEL_CATALOG_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 30 * 1000;

function getRemoteLanguageModelCatalogUrl() {
  if (process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL) {
    return process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL;
  }

  if (process.env.E2E_TEST_BUILD === "true" && process.env.FAKE_LLM_PORT) {
    return `http://localhost:${process.env.FAKE_LLM_PORT}/api/language-model-catalog`;
  }

  return "https://api.dyad.sh/v1/language-model-catalog";
}

export type { ThemeGenerationModelOption };

const CatalogProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.literal("cloud"),
  hasFreeTier: z.boolean().optional(),
  websiteUrl: z.string().optional(),
  secondary: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  gatewayPrefix: z.string().optional(),
});

const CatalogModelSchema = z.object({
  apiName: z.string(),
  displayName: z.string(),
  description: z.string(),
  tag: z.string().optional(),
  tagColor: z.string().optional(),
  dollarSigns: z.number().optional(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  contextWindow: z.number().optional(),
  lifecycle: z
    .object({
      stage: z.enum(["stable", "preview", "deprecated"]).optional(),
    })
    .optional(),
});

const KNOWN_BUILTIN_MODEL_ALIASES = [
  "dyad/theme-generator/google",
  "dyad/theme-generator/anthropic",
  "dyad/theme-generator/openai",
  "dyad/auto/openai",
  "dyad/auto/anthropic",
  "dyad/auto/google",
  "dyad/help-bot/default",
] as const;

export type BuiltinModelAlias = (typeof KNOWN_BUILTIN_MODEL_ALIASES)[number];

const LanguageModelCatalogResponseSchema = z.object({
  version: z.string(),
  expiresAt: z.string().datetime().optional(),
  providers: z.array(CatalogProviderSchema),
  modelsByProvider: z.record(z.string(), z.array(CatalogModelSchema)),
  aliases: z.array(
    z.object({
      id: z.string(),
      resolvedModel: z.object({
        providerId: z.string(),
        apiName: z.string(),
      }),
      displayName: z.string().optional(),
      purpose: z.enum(["theme-generation", "auto-mode", "help-bot"]).optional(),
    }),
  ),
  curatedSelections: z
    .object({
      themeGenerationOptions: z.array(ThemeGenerationModelOptionSchema),
    })
    .optional(),
});

type LanguageModelCatalogResponse = z.infer<
  typeof LanguageModelCatalogResponseSchema
>;

type BuiltinLanguageModelCatalog = {
  providers: LanguageModelProvider[];
  modelsByProvider: Record<string, LanguageModel[]>;
  aliases: LanguageModelCatalogResponse["aliases"];
  themeGenerationOptions: ThemeGenerationModelOption[];
  expiresAt: number;
  source: "fallback" | "remote";
  version?: string;
};

type ResolvedBuiltinModel = {
  providerId: string;
  apiName: string;
};

let builtinCatalogCache: BuiltinLanguageModelCatalog | null = null;
let builtinCatalogFetchPromise: Promise<BuiltinLanguageModelCatalog> | null =
  null;

const DEFAULT_THEME_GENERATION_OPTIONS: ThemeGenerationModelOption[] = [
  { id: "dyad/theme-generator/google", label: "Google" },
  { id: "dyad/theme-generator/anthropic", label: "Anthropic" },
  { id: "dyad/theme-generator/openai", label: "OpenAI" },
];

function buildFallbackCatalog(): BuiltinLanguageModelCatalog {
  const providers: LanguageModelProvider[] = Object.entries(
    CLOUD_PROVIDERS,
  ).map(([providerId, provider]) => ({
    id: providerId,
    name: provider.displayName,
    hasFreeTier: provider.hasFreeTier,
    websiteUrl: provider.websiteUrl,
    gatewayPrefix: provider.gatewayPrefix,
    secondary: provider.secondary,
    envVarName:
      PROVIDER_TO_ENV_VAR[providerId as keyof typeof PROVIDER_TO_ENV_VAR] ??
      undefined,
    type: "cloud",
  }));

  const modelsByProvider: Record<string, LanguageModel[]> = {};
  for (const [providerId, models] of Object.entries(MODEL_OPTIONS)) {
    modelsByProvider[providerId] = models.map((model) => ({
      apiName: model.name,
      displayName: model.displayName,
      description: model.description,
      tag: model.tag,
      tagColor: model.tagColor,
      maxOutputTokens: model.maxOutputTokens,
      contextWindow: model.contextWindow,
      temperature: model.temperature,
      dollarSigns: model.dollarSigns,
      type: "cloud",
    }));
  }

  return {
    providers,
    modelsByProvider,
    aliases: [
      {
        id: "dyad/theme-generator/google",
        resolvedModel: {
          providerId: "google",
          apiName: GEMINI_3_1_PRO_PREVIEW,
        },
        displayName: "Google",
        purpose: "theme-generation",
      },
      {
        id: "dyad/theme-generator/anthropic",
        resolvedModel: {
          providerId: "anthropic",
          apiName: OPUS_4_6,
        },
        displayName: "Anthropic",
        purpose: "theme-generation",
      },
      {
        id: "dyad/theme-generator/openai",
        resolvedModel: {
          providerId: "openai",
          apiName: GPT_5_2_MODEL_NAME,
        },
        displayName: "OpenAI",
        purpose: "theme-generation",
      },
      {
        id: "dyad/auto/openai",
        resolvedModel: {
          providerId: "openai",
          apiName: GPT_5_2_MODEL_NAME,
        },
        displayName: "Auto OpenAI",
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/anthropic",
        resolvedModel: {
          providerId: "anthropic",
          apiName: SONNET_4_6,
        },
        displayName: "Auto Anthropic",
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/google",
        resolvedModel: {
          providerId: "google",
          apiName: GEMINI_3_FLASH,
        },
        displayName: "Auto Google",
        purpose: "auto-mode",
      },
      {
        id: "dyad/help-bot/default",
        resolvedModel: {
          providerId: "openai",
          apiName: GPT_5_NANO,
        },
        displayName: "Help Bot",
        purpose: "help-bot",
      },
    ],
    themeGenerationOptions: DEFAULT_THEME_GENERATION_OPTIONS,
    expiresAt: Date.now() + FALLBACK_CACHE_TTL_MS,
    source: "fallback",
  };
}

function convertRemoteCatalog(
  remoteCatalog: LanguageModelCatalogResponse,
): BuiltinLanguageModelCatalog {
  const providers: LanguageModelProvider[] = remoteCatalog.providers.map(
    (provider) => ({
      id: provider.id,
      name: provider.displayName,
      hasFreeTier: provider.hasFreeTier,
      websiteUrl: provider.websiteUrl,
      gatewayPrefix:
        provider.gatewayPrefix ??
        CLOUD_PROVIDERS[provider.id as keyof typeof CLOUD_PROVIDERS]
          ?.gatewayPrefix,
      secondary: provider.secondary,
      envVarName:
        PROVIDER_TO_ENV_VAR[provider.id as keyof typeof PROVIDER_TO_ENV_VAR] ??
        undefined,
      type: "cloud",
    }),
  );

  const modelsByProvider = Object.fromEntries(
    Object.entries(remoteCatalog.modelsByProvider).map(
      ([providerId, models]) => [
        providerId,
        models.map((model) => ({
          apiName: model.apiName,
          displayName: model.displayName,
          description: model.description,
          tag: model.tag,
          tagColor: model.tagColor,
          maxOutputTokens: model.maxOutputTokens,
          contextWindow: model.contextWindow,
          temperature: model.temperature,
          dollarSigns: model.dollarSigns,
          type: "cloud" as const,
        })),
      ],
    ),
  );

  const parsedExpiresAt = remoteCatalog.expiresAt
    ? new Date(remoteCatalog.expiresAt).getTime()
    : NaN;

  // Merge required builtin aliases that may be missing from the remote catalog.
  const fallback = buildFallbackCatalog();
  const remoteAliasIds = new Set(remoteCatalog.aliases.map((a) => a.id));
  const mergedAliases = [
    ...remoteCatalog.aliases,
    ...fallback.aliases.filter((a) => !remoteAliasIds.has(a.id)),
  ];

  return {
    providers,
    modelsByProvider,
    aliases: mergedAliases,
    themeGenerationOptions: remoteCatalog.curatedSelections
      ?.themeGenerationOptions?.length
      ? remoteCatalog.curatedSelections.themeGenerationOptions
      : DEFAULT_THEME_GENERATION_OPTIONS,
    expiresAt:
      Number.isFinite(parsedExpiresAt) && parsedExpiresAt > Date.now()
        ? parsedExpiresAt
        : Date.now() + DEFAULT_CACHE_TTL_MS,
    source: "remote",
    version: remoteCatalog.version,
  };
}

async function fetchRemoteCatalog(): Promise<BuiltinLanguageModelCatalog | null> {
  const controller = new AbortController();
  const catalogUrl = getRemoteLanguageModelCatalogUrl();
  const timeoutId = setTimeout(
    () => controller.abort(),
    REMOTE_LANGUAGE_MODEL_CATALOG_TIMEOUT_MS,
  );

  try {
    logger.info("Fetching remote language model catalog", {
      catalogUrl,
      timeoutMs: REMOTE_LANGUAGE_MODEL_CATALOG_TIMEOUT_MS,
    });

    const response = await fetch(catalogUrl, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new DyadError(
        `Failed to fetch language model catalog: ${response.status} ${response.statusText}`,
        DyadErrorKind.External,
      );
    }

    const rawCatalog = await response.json();
    const remoteCatalog = LanguageModelCatalogResponseSchema.parse(rawCatalog);
    const convertedCatalog = convertRemoteCatalog(remoteCatalog);

    logger.info("Loaded remote language model catalog", {
      catalogUrl,
      version: convertedCatalog.version,
      providerCount: convertedCatalog.providers.length,
      aliasCount: convertedCatalog.aliases.length,
      themeGenerationOptionCount:
        convertedCatalog.themeGenerationOptions.length,
    });

    return convertedCatalog;
  } catch (error) {
    logger.warn("Failed to fetch remote language model catalog", {
      catalogUrl,
      error,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getFallbackCatalog(): BuiltinLanguageModelCatalog {
  return buildFallbackCatalog();
}

function triggerBackgroundRefresh(): void {
  if (!builtinCatalogFetchPromise) {
    logger.info("Starting background refresh for language model catalog", {
      cachedSource: builtinCatalogCache?.source,
    });
    builtinCatalogFetchPromise = (async () => {
      try {
        const remoteCatalog = await fetchRemoteCatalog();
        builtinCatalogCache = remoteCatalog ?? getFallbackCatalog();
        logger.info("Background refresh completed for language model catalog", {
          source: builtinCatalogCache.source,
          version: builtinCatalogCache.version,
          providerCount: builtinCatalogCache.providers.length,
        });
        return builtinCatalogCache;
      } finally {
        builtinCatalogFetchPromise = null;
      }
    })();
  } else {
    logger.info(
      "Skipping language model catalog refresh because one is in flight",
    );
  }
}

export async function getBuiltinLanguageModelCatalog(): Promise<BuiltinLanguageModelCatalog> {
  if (builtinCatalogCache && builtinCatalogCache.expiresAt > Date.now()) {
    logger.info("Returning cached language model catalog", {
      source: builtinCatalogCache.source,
      version: builtinCatalogCache.version,
      expiresAt: new Date(builtinCatalogCache.expiresAt).toISOString(),
    });
    return builtinCatalogCache;
  }

  // Serve stale data while revalidating in the background to avoid blocking
  // callers on a network fetch (stale-while-revalidate pattern).
  if (builtinCatalogCache) {
    logger.info(
      "Returning stale language model catalog and refreshing in background",
      {
        source: builtinCatalogCache.source,
        version: builtinCatalogCache.version,
      },
    );
    triggerBackgroundRefresh();
    return builtinCatalogCache;
  }

  // On cold start, wait for the initial remote fetch so renderer queries do not
  // cache fallback data and miss the later background refresh result.
  if (!builtinCatalogFetchPromise) {
    logger.info("Cold start catalog request; waiting for initial remote fetch");
    builtinCatalogFetchPromise = (async () => {
      try {
        const remoteCatalog = await fetchRemoteCatalog();
        builtinCatalogCache = remoteCatalog ?? getFallbackCatalog();
        logger.info(
          "Initialized language model catalog after cold start fetch",
          {
            source: builtinCatalogCache.source,
            version: builtinCatalogCache.version,
            providerCount: builtinCatalogCache.providers.length,
            aliasCount: builtinCatalogCache.aliases.length,
          },
        );
        return builtinCatalogCache;
      } finally {
        builtinCatalogFetchPromise = null;
      }
    })();
  } else {
    logger.info("Cold start catalog request is waiting on in-flight fetch");
  }

  return builtinCatalogFetchPromise;
}

export async function getThemeGenerationModelOptions(): Promise<
  ThemeGenerationModelOption[]
> {
  const catalog = await getBuiltinLanguageModelCatalog();
  return catalog.themeGenerationOptions;
}

export async function resolveBuiltinModelAlias(
  aliasId: BuiltinModelAlias | string,
): Promise<ResolvedBuiltinModel | null> {
  const catalog = await getBuiltinLanguageModelCatalog();
  const resolvedModel =
    catalog.aliases.find((alias) => alias.id === aliasId)?.resolvedModel ??
    null;

  logger.info("Resolved builtin model alias", {
    aliasId,
    source: catalog.source,
    version: catalog.version,
    resolvedProviderId: resolvedModel?.providerId,
    resolvedApiName: resolvedModel?.apiName,
  });

  return resolvedModel;
}
