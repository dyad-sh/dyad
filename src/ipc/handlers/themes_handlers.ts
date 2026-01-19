import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { themesData, type Theme } from "../../shared/themes";
import { db } from "../../db";
import { apps, customThemes } from "../../db/schema";
import { eq, sql, or, isNull } from "drizzle-orm";
import { streamText, TextPart, ImagePart } from "ai";
import { readSettings } from "../../main/settings";
import { getModelClient } from "../utils/get_model_client";
import type {
  SetAppThemeParams,
  GetAppThemeParams,
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  DeleteCustomThemeParams,
  GetCustomThemesParams,
  GenerateThemePromptParams,
  GenerateThemePromptResult,
} from "../ipc_types";

const logger = log.scope("themes_handlers");
const handle = createLoggedHandler(logger);

const THEME_GENERATION_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that extracts a reusable UI DESIGN SYSTEM from provided images.
- This is a visual ruleset, not a website blueprint.
- Extract constraints, scales, and principles — never layouts or compositions.
- You are NOT recreating, cloning, or reverse-engineering a specific website.
- The resulting system must be applicable to unrelated products without visual resemblance.

SCOPE & LIMITATIONS (MANDATORY)
- Do NOT reproduce:
  - Page layouts
  - Component hierarchies
  - Spatial arrangements
  - Relative positioning between elements
  - Information architecture
- Do NOT describe the original interface.
- Do NOT reference screen structure, sections, or flows.
- The output must remain abstract, systemic, and transferable.

INPUTS
- One or more UI images
- Optional reference name (popular product or known design system)
- Visual input defines stylistic constraints only (tokens, shapes, motion, density)

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Hard Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales
  - All styling must be token-driven

OUTPUT RULES
- Wrap the entire output in <theme></theme> tags.
- Output exactly ONE SYSTEM PROMPT that:
  - Names the inspiration strictly as a stylistic reference, not a target
  - Defines enforceable rules, never descriptions
  - Uses imperative language only ("must", "never", "always")
  - Never mentions images, screenshots, or visual analysis
  - Produces a system that cannot recreate the original UI even if followed precisely

REQUIRED STRUCTURE
- Visual Objective (abstract, non-descriptive)
- Layout & Spacing Rules (scales only, no patterns)
- Typography System (roles, hierarchy, constraints)
- Color & Surfaces (tokens, elevation logic)
- Components & Shape Language (geometry, affordances — no layouts)
- Motion & Interaction (timing, intent, limits)
- Forbidden Patterns (explicit anti-cloning rules)
- Self-Check (verifies abstraction & non-replication)
`;

const HIGH_FIDELITY_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that allows an AI to recreate a UI visual system from a provided image.
- This is a visual subsystem. Do not define roles or personas.
- Extract rules, not descriptions.

INPUTS
- One or more UI images
- Optional reference name (popular product / design system)
- Image always takes priority.

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales

OUTPUT RULES
- Wrap the entire output in <theme></theme> tags.
- Output one SYSTEM PROMPT that:
  - Explicitly names the inspiration as a guiding reference
  - Uses hard, enforceable rules only
  - Is technical and unambiguous
  - Never mentions the image 
  - Avoids vague language ("might", "appears", etc.)

REQUIRED STRUCTURE
- Visual Objective
- Layout & Spacing Rules
- Typography System
- Color & Surfaces
- Components & Shape Language
- Motion & Interaction
- Forbidden Patterns
- Self-Check
`;

export function registerThemesHandlers() {
  // Get built-in themes
  handle("get-themes", async (): Promise<Theme[]> => {
    return themesData;
  });

  // Set app theme (built-in or custom theme ID)
  handle(
    "set-app-theme",
    async (_, params: SetAppThemeParams): Promise<void> => {
      const { appId, themeId } = params;
      // Use raw SQL to properly set NULL when themeId is null (representing "no theme")
      if (!themeId) {
        await db
          .update(apps)
          .set({ themeId: sql`NULL` })
          .where(eq(apps.id, appId));
      } else {
        await db.update(apps).set({ themeId }).where(eq(apps.id, appId));
      }
    },
  );

  // Get app theme
  handle(
    "get-app-theme",
    async (_, params: GetAppThemeParams): Promise<string | null> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
        columns: { themeId: true },
      });
      return app?.themeId ?? null;
    },
  );

  // Get custom themes (global + app-specific if appId provided)
  handle(
    "get-custom-themes",
    async (_, params: GetCustomThemesParams): Promise<CustomTheme[]> => {
      const { appId } = params;

      // Get global themes (appId is null) and optionally app-specific themes
      const themes = await db.query.customThemes.findMany({
        where:
          appId != null
            ? or(isNull(customThemes.appId), eq(customThemes.appId, appId))
            : isNull(customThemes.appId),
        orderBy: (themes, { desc }) => [desc(themes.createdAt)],
      });

      return themes.map((t) => ({
        id: t.id,
        appId: t.appId,
        name: t.name,
        description: t.description,
        prompt: t.prompt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    },
  );

  // Create custom theme
  handle(
    "create-custom-theme",
    async (_, params: CreateCustomThemeParams): Promise<CustomTheme> => {
      const result = await db
        .insert(customThemes)
        .values({
          appId: params.appId ?? null, // null for global themes
          name: params.name,
          description: params.description ?? null,
          prompt: params.prompt,
        })
        .returning();

      const theme = result[0];
      return {
        id: theme.id,
        appId: theme.appId,
        name: theme.name,
        description: theme.description,
        prompt: theme.prompt,
        createdAt: theme.createdAt,
        updatedAt: theme.updatedAt,
      };
    },
  );

  // Update custom theme
  handle(
    "update-custom-theme",
    async (_, params: UpdateCustomThemeParams): Promise<CustomTheme> => {
      const updateData: Partial<{
        name: string;
        description: string | null;
        prompt: string;
        updatedAt: Date;
      }> = {
        updatedAt: new Date(),
      };

      if (params.name !== undefined) updateData.name = params.name;
      if (params.description !== undefined)
        updateData.description = params.description;
      if (params.prompt !== undefined) updateData.prompt = params.prompt;

      const result = await db
        .update(customThemes)
        .set(updateData)
        .where(eq(customThemes.id, params.id))
        .returning();

      const theme = result[0];
      return {
        id: theme.id,
        appId: theme.appId,
        name: theme.name,
        description: theme.description,
        prompt: theme.prompt,
        createdAt: theme.createdAt,
        updatedAt: theme.updatedAt,
      };
    },
  );

  // Delete custom theme
  handle(
    "delete-custom-theme",
    async (_, params: DeleteCustomThemeParams): Promise<void> => {
      await db.delete(customThemes).where(eq(customThemes.id, params.id));
    },
  );

  // Generate theme prompt using AI (Dyad Pro)
  handle(
    "generate-theme-prompt",
    async (
      _,
      params: GenerateThemePromptParams,
    ): Promise<GenerateThemePromptResult> => {
      const settings = readSettings();

      if (!settings.enableDyadPro) {
        throw new Error(
          "Dyad Pro is required for AI theme generation. Please enable Dyad Pro in Settings.",
        );
      }

      // Use user's selected model via Dyad Pro gateway
      const { modelClient } = await getModelClient(
        settings.selectedModel,
        settings,
      );

      // Select system prompt based on generation mode
      const systemPrompt =
        params.generationMode === "high-fidelity"
          ? HIGH_FIDELITY_META_PROMPT
          : THEME_GENERATION_META_PROMPT;

      logger.log(
        `Generating theme prompt with model: ${settings.selectedModel.name}, images: ${params.images.length}, mode: ${params.generationMode}`,
      );

      // Build the user input prompt
      const keywordsPart = params.keywords.trim() || "N/A";
      const imagesPart =
        params.images.length > 0
          ? `${params.images.length} image(s) attached`
          : "N/A";
      const userInput = `inspired by: ${keywordsPart}
images: ${imagesPart}`;

      // Try with images first if available
      if (params.images.length > 0) {
        try {
          const contentParts: (TextPart | ImagePart)[] = [];

          // Add user input text first
          contentParts.push({ type: "text", text: userInput });

          // Add images
          for (const imageData of params.images) {
            contentParts.push({
              type: "image",
              image: imageData,
              mediaType: "image/png",
            } as ImagePart);
            logger.log(`Added image, base64 length: ${imageData.length}`);
          }

          const stream = streamText({
            model: modelClient.model,
            system: systemPrompt,
            maxRetries: 1,
            messages: [{ role: "user", content: contentParts }],
          });

          const result = await stream.text;

          logger.log(
            `Theme generation with images succeeded, result length: ${result.length}`,
          );

          return { prompt: result };
        } catch (imageError) {
          logger.warn(
            "Image-based generation failed, falling back to text-only:",
            imageError,
          );
          // Fall through to text-only generation
        }
      }

      // Text-only generation (fallback or when no images)
      try {
        const stream = streamText({
          model: modelClient.model,
          system: systemPrompt,
          maxRetries: 2,
          messages: [{ role: "user", content: userInput }],
        });

        const result = await stream.text;

        logger.log(
          `Theme generation (text-only) succeeded, result length: ${result.length}`,
        );

        return { prompt: result };
      } catch (error) {
        logger.error("Theme generation error:", error);
        throw error;
      }
    },
  );
}

/**
 * Async function to resolve theme prompt by ID.
 * Handles both built-in themes (by ID) and custom themes (prefixed with "custom:")
 */
export async function getThemePromptById(
  themeId: string | null,
): Promise<string> {
  if (!themeId) {
    return "";
  }

  // Check if it's a custom theme
  if (themeId.startsWith("custom:")) {
    const numericId = parseInt(themeId.replace("custom:", ""), 10);
    if (isNaN(numericId)) {
      logger.warn(`Invalid custom theme ID: ${themeId}`);
      return "";
    }

    const customTheme = await db.query.customThemes.findFirst({
      where: eq(customThemes.id, numericId),
    });

    if (!customTheme) {
      logger.warn(`Custom theme not found: ${themeId}`);
      return "";
    }

    return customTheme.prompt;
  }

  // It's a built-in theme
  const builtinTheme = themesData.find((t) => t.id === themeId);
  return builtinTheme?.prompt ?? "";
}
