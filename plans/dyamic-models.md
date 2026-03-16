# Dynamic Models Plan

## Goal

Replace the baked-in builtin language model catalog in `src/ipc/shared/language_model_constants.ts` with an API-first catalog fetched from `api.dyad.sh`, while preserving `language_model_constants.ts` as a local fallback when the API is unavailable or invalid.

Also remove product-facing hardcoded model IDs where we currently encode specific model names in feature code, and instead derive those choices from API-provided aliases and ordered selections.

## Non-goals

- This plan does not implement the API itself.
- This plan does not migrate image generation or transcription model IDs unless we explicitly decide to broaden the API from "language model catalog" to a larger "AI model catalog".
- This plan does not remove custom provider/model support stored in the local DB.

## Design principles

- API-first: builtin provider/model metadata should come from `api.dyad.sh`.
- Fallback-safe: the app must still work offline or during API outages.
- IPC-stable: existing renderer IPC consumers should continue to read providers/models through the current IPC surface.
- Product-intent driven: feature code should reference stable aliases, not concrete vendor model IDs.
- Minimal scope: only add the alias set required by current product behavior.

## Current state

Today `src/ipc/shared/language_model_constants.ts` mixes several responsibilities:

- builtin provider catalog
- builtin model catalog
- product defaults and curated model choices
- app-internal provider metadata

Builtin model data is surfaced through `src/ipc/shared/language_model_helpers.ts`, which is already the main-process source of truth behind:

- `get-language-model-providers`
- `get-language-models`
- `get-language-models-by-providers`

This is good because we can make the model catalog dynamic inside the main process without forcing a renderer-wide contract change.

## Proposed architecture

### 1. Split remote catalog from local fallback

Keep `src/ipc/shared/language_model_constants.ts`, but reposition it as fallback data and app-local metadata instead of the primary source of builtin models.

The remote API should own:

- builtin cloud providers
- builtin cloud models
- display names
- descriptions
- pricing tier indicators
- tags
- context/output token limits
- curated aliases for product selections

The local app code should continue to own:

- custom providers/models from the DB
- local providers like Ollama / LM Studio
- app-only wiring that should not depend on API reachability
- fallback copies of builtin provider/model metadata

### 2. Fetch remote catalog in main process

Add a main-process fetch utility for the language model catalog, similar in spirit to `src/ipc/utils/template_utils.ts`.

Behavior:

- fetch from `https://api.dyad.sh/v1/language-model-catalog`
- validate with Zod
- cache in memory
- de-duplicate in-flight fetches
- use TTL or `expiresAt` from the response
- on fetch or validation failure, log and return `null`

### 3. Keep renderer IPC unchanged where possible

`src/ipc/shared/language_model_helpers.ts` should become the source that:

- loads the remote builtin catalog when available
- falls back to local builtin constants otherwise
- merges local DB custom providers/models on top

This keeps the existing IPC contracts intact while changing the builtin data source underneath.

### 4. Add alias resolution for product-level model choices

Any product code that currently hardcodes a concrete builtin model should stop importing exact model IDs and instead resolve an alias to a `{ providerId, apiName }` pair.

This allows the API to update the concrete model without requiring an app release.

## Minimal alias set needed today

We agreed to keep the alias surface minimal and not add provider-level aliases yet.

Required aliases:

- `dyad/theme-generator/google`
- `dyad/theme-generator/anthropic`
- `dyad/theme-generator/openai`
- `dyad/auto/openai`
- `dyad/auto/anthropic`
- `dyad/auto/google`
- `dyad/help-bot/default`

Not needed:

- `dyad/theme-generator/default`

For theme generation, the UI will use the first option returned by the API as the default selected option.

## Proposed API schema

Endpoint:

`GET https://api.dyad.sh/v1/language-model-catalog`

Suggested response shape:

```ts
type LanguageModelCatalogResponse = {
  version: string;
  expiresAt?: string;
  providers: Array<{
    id: string;
    displayName: string;
    type: "cloud";
    hasFreeTier?: boolean;
    websiteUrl?: string;
    secondary?: boolean;
    supportsThinking?: boolean;
    gatewayPrefix?: string;
  }>;
  modelsByProvider: Record<
    string,
    Array<{
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
      tagColor?: string;
      dollarSigns?: number;
      temperature?: number;
      maxOutputTokens?: number;
      contextWindow?: number;
      lifecycle?: {
        stage?: "stable" | "preview" | "deprecated";
      };
    }>
  >;
  aliases: Array<{
    id: string;
    resolvedModel: {
      providerId: string;
      apiName: string;
    };
    displayName?: string;
    purpose?: "theme-generation" | "auto-mode" | "help-bot";
  }>;
  curatedSelections?: {
    themeGenerationOptions: Array<{
      id:
        | "dyad/theme-generator/google"
        | "dyad/theme-generator/anthropic"
        | "dyad/theme-generator/openai";
      label: string;
    }>;
  };
};
```

## API semantics

### Builtin providers/models

- The API owns the builtin cloud catalog.
- The app still injects local providers and DB-backed custom providers/models separately.

### Aliases

Aliases are stable app-facing identifiers for product decisions.

For example:

- `dyad/theme-generator/google` resolves to the concrete Google model to use for theme generation.
- `dyad/auto/openai` resolves to the concrete OpenAI model used in auto mode.
- `dyad/help-bot/default` resolves to the concrete model used by the help bot.

### Theme generator ordering

The API should return `curatedSelections.themeGenerationOptions` in display order.

The client will:

- render the returned options in that order
- use the first returned option as the default selected option
- use the first returned option again when resetting the dialog state

This removes the need for a dedicated `dyad/theme-generator/default` alias.

### Auto mode ordering

Keep auto-mode order in app code for now.

The app can try aliases in this order:

1. `dyad/auto/openai`
2. `dyad/auto/anthropic`
3. `dyad/auto/google`

That keeps the API smaller while still eliminating hardcoded concrete model IDs.

## Planned implementation steps

### 1. Add remote catalog schema + fetch utility

Add a new main-process utility to:

- fetch the remote catalog
- validate it with Zod
- cache it in memory
- expose helpers like:
  - `getRemoteLanguageModelCatalog()`
  - `resolveBuiltinModelAlias(aliasId)`

### 2. Refactor local constants into fallback role

Update `src/ipc/shared/language_model_constants.ts` so it is clearly the fallback builtin catalog plus app-local metadata.

Avoid using it as the source of product-curated model choices.

### 3. Update language model helpers to use API-first resolution

Refactor `src/ipc/shared/language_model_helpers.ts`:

- `getLanguageModelProviders()`
  - use remote builtin providers when available
  - fall back to local builtin providers otherwise
  - merge DB custom providers
  - append local providers
- `getLanguageModels({ providerId })`
  - use remote builtin models when available
  - fall back to local builtin models otherwise
  - merge DB custom models
- `getLanguageModelsByProviders()`
  - keep existing behavior, but sourcing builtin data from the API-backed helper

### 4. Add alias resolver for product code

Add a helper that resolves aliases from the remote catalog, with local fallback mapping if the API is unavailable.

Suggested shape:

```ts
type ResolvedBuiltinModel = {
  providerId: string;
  apiName: string;
};

async function resolveBuiltinModelAlias(
  aliasId: string,
): Promise<ResolvedBuiltinModel | null>;
```

### 5. Migrate theme generator to alias-based options

Replace the hardcoded theme generator model enum and mapping with API-derived ordered options.

Desired end state:

- the UI no longer hardcodes `gemini-3-pro`, `claude-opus-4.5`, `gpt-5.2`
- `ThemeGenerationModel` becomes a string alias ID rather than a fixed `z.enum([...])`
- the backend resolves the alias to the concrete provider/model pair before calling `getModelClient`

### 6. Migrate auto mode to alias-based builtin model resolution

Replace the current hardcoded concrete auto-model list with:

- `dyad/auto/openai`
- `dyad/auto/anthropic`
- `dyad/auto/google`

The app keeps the fallback ordering logic locally.

### 7. Migrate help bot to alias-based resolution

Replace the concrete help-bot model ID with:

- `dyad/help-bot/default`

### 8. Leave tests and unrelated model types alone unless necessary

Do not broaden scope into:

- image generation model constants
- transcription model constants
- test-only literals like `gpt-4`

unless the implementation forces us to touch them.

## Hardcoded model-name audit

### High-priority product-facing hardcodes

#### Theme generator UI

File:

- `src/components/AIGeneratorTab.tsx`

Current issues:

- hardcoded default theme generation model
- hardcoded UI choices for Google / Anthropic / OpenAI

Planned change:

- fetch theme-generation options from API-backed IPC
- use first returned option as default
- store alias ID instead of concrete model name

#### Theme generator IPC types

File:

- `src/ipc/types/templates.ts`

Current issues:

- `ThemeGenerationModelSchema` is a fixed `z.enum([...])`

Planned change:

- replace with `z.string()` or a constrained alias-oriented schema
- treat the value as an alias ID, not a concrete model ID

#### Theme generator backend mapping

File:

- `src/pro/main/ipc/handlers/themes_handlers.ts`

Current issues:

- `THEME_GENERATION_MODEL_MAP` hardcodes alias-like UI values to concrete provider/model pairs

Planned change:

- replace this with alias resolution from the API-backed catalog

#### Auto mode

File:

- `src/ipc/utils/get_model_client.ts`

Current issues:

- `AUTO_MODELS` hardcodes exact provider/model pairs
- the Dyad Pro local-agent fallback also hardcodes exact concrete models

Planned change:

- resolve `dyad/auto/openai`
- resolve `dyad/auto/anthropic`
- resolve `dyad/auto/google`
- keep the ordering in app code

#### Help bot

File:

- `src/ipc/handlers/help_bot_handlers.ts`

Current issues:

- concrete model ID is hardcoded

Planned change:

- resolve `dyad/help-bot/default`

### Lower-priority hardcodes not in scope for first pass

#### Image generation

File:

- `src/pro/main/ipc/handlers/local_agent/tools/generate_image.ts`

Current issue:

- hardcoded image generation model

Reason not in first pass:

- this plan is for builtin language model catalog migration, not a broader AI model registry

#### Test fixtures and assertions

Examples:

- `src/__tests__/local_agent_handler.test.ts`
- `src/__tests__/prepare_step_utils.test.ts`
- `src/__tests__/readSettings.test.ts`

Reason not in first pass:

- these are test literals and not user-facing model-catalog decisions

## Rollout order

1. Add remote catalog schema and fetch utility
2. Switch builtin providers/models in `language_model_helpers.ts` to API-first with fallback
3. Add alias resolution helper
4. Migrate theme generator to ordered alias-based options
5. Migrate auto mode to alias-based resolution
6. Migrate help bot to alias-based resolution
7. Remove remaining product-facing imports of concrete builtin model constants where possible

## Risks and tradeoffs

### API unavailability

Risk:

- builtin model catalog could fail to load at runtime

Mitigation:

- local fallback catalog remains complete and functional

### Invalid API payload

Risk:

- malformed API response could break model loading

Mitigation:

- strict Zod validation
- log and fall back locally on any validation error

### Theme generator contract migration

Risk:

- changing `ThemeGenerationModel` from fixed enum to alias string touches both UI and IPC contracts

Mitigation:

- keep the change narrow and migrate both sides together

### Partial migration

Risk:

- model catalog becomes dynamic but product code still hardcodes concrete model IDs

Mitigation:

- explicitly migrate the high-priority hardcoded call sites in the same project

## Success criteria

- Builtin cloud providers/models are fetched from `api.dyad.sh` when available.
- The app falls back to `language_model_constants.ts` when the API fails or returns invalid data.
- Existing IPC provider/model queries continue to work.
- Theme generator no longer hardcodes specific builtin model IDs.
- Auto mode no longer hardcodes specific builtin model IDs.
- Help bot no longer hardcodes a specific builtin model ID.
- The minimal alias set above is sufficient for current product behavior.
