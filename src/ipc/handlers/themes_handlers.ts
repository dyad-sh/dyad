import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { themesData, type Theme } from "../../shared/themes";
import { db } from "../../db";
import { apps, customThemes } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
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

  // Get all custom themes
  handle("get-custom-themes", async (): Promise<CustomTheme[]> => {
    const themes = await db.query.customThemes.findMany({
      orderBy: (themes, { desc }) => [desc(themes.createdAt)],
    });

    return themes.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      prompt: t.prompt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  });

  // Create custom theme
  handle(
    "create-custom-theme",
    async (_, params: CreateCustomThemeParams): Promise<CustomTheme> => {
      // Validate and sanitize inputs
      const trimmedName = params.name.trim();
      const trimmedDescription = params.description?.trim();
      const trimmedPrompt = params.prompt.trim();

      // Validate name
      if (!trimmedName) {
        throw new Error("Theme name is required");
      }
      if (trimmedName.length > 100) {
        throw new Error("Theme name must be less than 100 characters");
      }

      // Validate description
      if (trimmedDescription && trimmedDescription.length > 500) {
        throw new Error("Theme description must be less than 500 characters");
      }

      // Validate prompt
      if (!trimmedPrompt) {
        throw new Error("Theme prompt is required");
      }
      if (trimmedPrompt.length > 50000) {
        throw new Error("Theme prompt must be less than 50,000 characters");
      }

      // Check for duplicate theme name (case-insensitive)
      const existingTheme = await db.query.customThemes.findFirst({
        where: sql`LOWER(${customThemes.name}) = LOWER(${trimmedName})`,
      });

      if (existingTheme) {
        throw new Error(
          `A theme named "${trimmedName}" already exists. Please choose a different name.`,
        );
      }

      const result = await db
        .insert(customThemes)
        .values({
          name: trimmedName,
          description: trimmedDescription || null,
          prompt: trimmedPrompt,
        })
        .returning();

      const theme = result[0];
      return {
        id: theme.id,
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

      // Get the current theme to verify it exists
      const currentTheme = await db.query.customThemes.findFirst({
        where: eq(customThemes.id, params.id),
      });

      if (!currentTheme) {
        throw new Error("Theme not found");
      }

      // Validate and sanitize name if provided
      if (params.name !== undefined) {
        const trimmedName = params.name.trim();
        if (!trimmedName) {
          throw new Error("Theme name is required");
        }
        if (trimmedName.length > 100) {
          throw new Error("Theme name must be less than 100 characters");
        }

        // Check for duplicate theme name (case-insensitive), excluding current theme
        const existingTheme = await db.query.customThemes.findFirst({
          where: sql`LOWER(${customThemes.name}) = LOWER(${trimmedName}) AND ${customThemes.id} != ${params.id}`,
        });

        if (existingTheme) {
          throw new Error(
            `A theme named "${trimmedName}" already exists. Please choose a different name.`,
          );
        }

        updateData.name = trimmedName;
      }

      // Validate and sanitize description if provided
      if (params.description !== undefined) {
        const trimmedDescription = params.description.trim();
        if (trimmedDescription.length > 500) {
          throw new Error("Theme description must be less than 500 characters");
        }
        updateData.description = trimmedDescription || null;
      }

      // Validate and sanitize prompt if provided
      if (params.prompt !== undefined) {
        const trimmedPrompt = params.prompt.trim();
        if (!trimmedPrompt) {
          throw new Error("Theme prompt is required");
        }
        if (trimmedPrompt.length > 50000) {
          throw new Error("Theme prompt must be less than 50,000 characters");
        }
        updateData.prompt = trimmedPrompt;
      }

      const result = await db
        .update(customThemes)
        .set(updateData)
        .where(eq(customThemes.id, params.id))
        .returning();

      const theme = result[0];
      if (!theme) {
        throw new Error("Theme not found");
      }

      return {
        id: theme.id,
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

      // Validate inputs - images are required
      if (params.images.length === 0) {
        throw new Error("Please upload at least one image to generate a theme");
      }

      if (params.images.length > 5) {
        throw new Error("Maximum 5 images allowed");
      }

      // Validate each image size
      for (const imageData of params.images) {
        const sizeInBytes = (imageData.length * 3) / 4; // Approximate base64 to bytes
        if (sizeInBytes > 10 * 1024 * 1024) {
          throw new Error("Individual image size exceeds 10MB limit");
        }
      }

      // Validate keywords length
      if (params.keywords.length > 500) {
        throw new Error("Keywords must be less than 500 characters");
      }

      // Validate generation mode
      if (!["inspired", "high-fidelity"].includes(params.generationMode)) {
        throw new Error("Invalid generation mode");
      }

      // Validate and map model selection
      const modelMap: Record<string, { provider: string; name: string }> = {
        "gemini-3-pro": { provider: "google", name: "gemini-3-pro-preview" },
        "gemini-3-flash": {
          provider: "google",
          name: "gemini-3-flash-preview",
        },
        "gpt-5.2": { provider: "openai", name: "gpt-5.2" },
      };

      const selectedModel = modelMap[params.model];
      if (!selectedModel) {
        throw new Error("Invalid model selection");
      }

      // Use the selected model for theme generation
      const { modelClient } = await getModelClient(selectedModel, settings);

      // Select system prompt based on generation mode
      const systemPrompt =
        params.generationMode === "high-fidelity"
          ? HIGH_FIDELITY_META_PROMPT
          : THEME_GENERATION_META_PROMPT;

      logger.log(
        `Generating theme prompt with model: ${params.model} (${selectedModel.name}), images: ${params.images.length}, mode: ${params.generationMode}`,
      );

      // Build the user input prompt
      const keywordsPart = params.keywords.trim() || "N/A";
      const imagesPart =
        params.images.length > 0
          ? `${params.images.length} image(s) attached`
          : "N/A";
      const userInput = `inspired by: ${keywordsPart}
images: ${imagesPart}`;

      // Generate theme with images
      try {
        const contentParts: (TextPart | ImagePart)[] = [];

        // Add user input text first
        contentParts.push({ type: "text", text: userInput });

        // Add images - let AI SDK auto-detect media type from base64 data
        for (const imageData of params.images) {
          contentParts.push({
            type: "image",
            image: imageData,
          } as ImagePart);
        }

        const stream = streamText({
          model: modelClient.model,
          system: systemPrompt,
          maxRetries: 1,
          messages: [{ role: "user", content: contentParts }],
        });

        const result = await stream.text;

        return { prompt: result };
      } catch {
        throw new Error(
          "Failed to process images for theme generation. Please try with fewer or smaller images, or use manual mode.",
        );
      }
    },
  );
}
