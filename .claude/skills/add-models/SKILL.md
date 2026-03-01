---
name: dyad:add-models
description: Add one or more AI models to the language model constants file, researching specs from official docs.
---

# Add Models

Add one or more AI models to `src/ipc/shared/language_model_constants.ts`, researching correct specifications from official documentation.

## Arguments

- `$ARGUMENTS`: Comma-separated list of model names to add (e.g., "gemini 3.1 pro, glm 5, sonnet 4.6").

## Instructions

1. **Parse the model list:**

   Split `$ARGUMENTS` by commas to get individual model names. Trim whitespace from each.

2. **Read the current constants file:**

   Read `src/ipc/shared/language_model_constants.ts` to understand:
   - Which providers exist and their current model entries
   - The naming conventions for each provider (e.g., `claude-sonnet-4-20250514` for Anthropic, `gemini-2.5-pro` for Google)
   - The structure of `ModelOption` entries (name, displayName, description, maxOutputTokens, contextWindow, temperature, dollarSigns)

3. **Identify the provider for each model:**

   Map each model to its provider based on the model name:
   - **Anthropic** (`anthropic`): Claude models (Opus, Sonnet, Haiku)
   - **OpenAI** (`openai`): GPT models
   - **Google** (`google`): Gemini models
   - **xAI** (`xai`): Grok models
   - **OpenRouter** (`openrouter`): Models from other providers (DeepSeek, Qwen, Moonshot/Kimi, Z-AI/GLM, etc.)
   - **Azure** (`azure`): Azure-hosted OpenAI models
   - **Bedrock** (`bedrock`): AWS Bedrock-hosted Anthropic models
   - **Vertex** (`vertex`): Google Vertex AI-hosted models

   If a model could belong to multiple providers (e.g., a new Anthropic model should go in `anthropic` AND potentially `bedrock`), add it to the primary provider. Ask the user if they also want it added to secondary providers.

4. **Research each model's specifications:**

   For each model, use WebSearch and WebFetch to look up the official documentation:
   - **Anthropic models**: Search `docs.anthropic.com` for model specs
   - **OpenAI models**: Search `platform.openai.com/docs/models` for model specs
   - **Google Gemini models**: Search `ai.google.dev/gemini-api/docs/models` for model specs
   - **xAI models**: Search `docs.x.ai/docs/models` for model specs
   - **OpenRouter models**: Search `openrouter.ai/<provider>/<model-name>` for model specs and pricing

   For each model, determine:
   - **API model name**: The exact string used in API calls (e.g., `claude-sonnet-4-5-20250929`, `gemini-2.5-pro`)
   - **Display name**: Human-readable name (e.g., "Claude Sonnet 4.5", "Gemini 2.5 Pro")
   - **Description**: Short description following the style of existing entries
   - **Max output tokens**: The model's maximum output token limit
   - **Context window**: The model's total context window size
   - **Temperature**: Default temperature (0 for most models, 1 for OpenAI, 1.0 for Gemini 3.x models)
   - **Dollar signs**: Cost tier from 0-6 based on pricing relative to other models in the same provider

   **Dollar signs guide** (approximate, based on per-million-token input pricing):
   - 0: Free
   - 1: Very cheap (<$0.50/M input tokens)
   - 2: Cheap ($0.50-$2/M)
   - 3: Moderate ($2-$8/M)
   - 4: Expensive ($8-$15/M)
   - 5: Very expensive ($15-$30/M)
   - 6: Premium ($30+/M)

5. **Follow provider-specific conventions:**

   Match the patterns used by existing entries:
   - **OpenAI**: `maxOutputTokens: undefined` (OpenAI errors with `max_tokens`), `temperature: 1`
   - **Anthropic**: `maxOutputTokens: 32_000`, `temperature: 0`
   - **Google**: `maxOutputTokens: 65_536 - 1` (exclusive upper bound for Vertex), `temperature` varies
   - **OpenRouter**: `maxOutputTokens: 32_000`, prefix model name with provider (e.g., `deepseek/deepseek-chat-v3.1`)
   - **Azure**: `maxOutputTokens` commented out, `temperature: 1`
   - **Bedrock**: Model names use ARN format (e.g., `us.anthropic.claude-sonnet-4-5-20250929-v1:0`)
   - **xAI**: `maxOutputTokens: 32_000`, `temperature: 0`

6. **Add the models to the constants file:**

   Insert each new model entry into the appropriate provider's array in `MODEL_OPTIONS`. Place new models:
   - At the **top** of the provider's array if it's the newest/most capable model
   - After existing models of the same family but before older generations
   - Add a comment with a link to the model's documentation page

   Also check if related arrays need updating:
   - `TURBO_MODELS`: If the model has a turbo variant
   - `PROVIDERS_THAT_SUPPORT_THINKING`: If adding a new provider that supports thinking

7. **Check for named constant exports:**

   If the new model is likely to be referenced elsewhere (like `SONNET_4_5` or `GPT_5_2_MODEL_NAME`), create a named constant export for it. Search the codebase for references to similar constants to determine if one is needed:

   ```
   grep -r "SONNET_4_5\|GPT_5_2_MODEL_NAME\|GEMINI_3_FLASH" src/
   ```

8. **Verify the changes compile:**

   ```
   npm run ts
   ```

   Fix any type errors if they occur.

9. **Summarize what was added:**

   Report to the user:
   - Which models were added and to which providers
   - The key specs for each (context window, max output, pricing tier)
   - Any models that couldn't be found or had ambiguous specifications
   - Any decisions that were made (e.g., choosing between model versions)
