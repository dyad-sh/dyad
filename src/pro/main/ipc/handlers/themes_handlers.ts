import { createLoggedHandler } from "../../../../ipc/handlers/safe_handle";
import log from "electron-log";
import path from "path";
import os from "os";
import fs from "fs";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { themesData, type Theme } from "../../../../shared/themes";
import { db } from "../../../../db";
import { apps, customThemes } from "../../../../db/schema";
import { eq, sql } from "drizzle-orm";
import { streamText, TextPart, ImagePart } from "ai";
import { readSettings } from "../../../../main/settings";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { getModelClient } from "../../../../ipc/utils/get_model_client";
import { v4 as uuidv4 } from "uuid";
import type {
  SetAppThemeParams,
  GetAppThemeParams,
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  DeleteCustomThemeParams,
  GenerateThemePromptParams,
  GenerateThemePromptResult,
  GenerateThemeFromUrlParams,
  SaveThemeImageParams,
  SaveThemeImageResult,
  CleanupThemeImagesParams,
} from "@/ipc/types";
import { webCrawlResponseSchema } from "./local_agent/tools/web_crawl";

const logger = log.scope("themes_handlers");
const handle = createLoggedHandler(logger);

// Shared model map for theme generation (used by both image and URL handlers)
const THEME_GENERATION_MODEL_MAP: Record<
  string,
  { provider: string; name: string }
> = {
  "gemini-3-pro": { provider: "google", name: "gemini-3-pro-preview" },
  "claude-opus-4.5": {
    provider: "anthropic",
    name: "claude-opus-4-5",
  },
  "gpt-5.2": { provider: "openai", name: "gpt-5.2" },
};

// Timeout for web crawl requests (120 seconds)
const WEB_CRAWL_TIMEOUT_MS = 120_000;

/**
 * Sanitizes external content before including it in LLM prompts.
 * Escapes markdown code block delimiters to prevent prompt injection.
 */
function sanitizeForPrompt(content: string): string {
  // Escape backtick sequences that could break out of code blocks
  // Replace ``` with escaped version to prevent code block injection
  return content.replace(/`{3,}/g, (match) => "\\`".repeat(match.length));
}

/**
 * Sanitizes user-provided keywords for use in prompts.
 * Limits length and removes potentially dangerous patterns.
 */
function sanitizeKeywords(keywords: string): string {
  // Trim and limit length
  let sanitized = keywords.trim().slice(0, 500);
  // Remove potential prompt injection patterns
  sanitized = sanitized.replace(/<\/?[^>]+(>|$)/g, ""); // Strip HTML-like tags
  sanitized = sanitized.replace(/`{3,}/g, ""); // Remove code block markers
  return sanitized;
}

// Directory for storing temporary theme images
const THEME_IMAGES_TEMP_DIR = path.join(os.tmpdir(), "dyad-theme-images");

// Ensure temp directory exists
if (!fs.existsSync(THEME_IMAGES_TEMP_DIR)) {
  fs.mkdirSync(THEME_IMAGES_TEMP_DIR, { recursive: true });
}

// Get mime type from extension
function getMimeTypeFromExtension(
  ext: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const mimeMap: Record<
    string,
    "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  > = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeMap[ext.toLowerCase()] || "image/png";
}

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

// Web crawl "inspired" mode prompt - separate from image-based prompt
const WEB_CRAWL_THEME_GENERATION_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that extracts a reusable UI DESIGN SYSTEM from a crawled website.
- You are provided with a screenshot image and markdown representation of a live website.
- This is a visual ruleset, not a website blueprint.
- Extract constraints, scales, and principles from the visual appearance.
- You are NOT recreating, cloning, or reverse-engineering the specific website.
- The resulting system must be applicable to unrelated products without visual resemblance.

INPUTS
- Screenshot image of the website (PRIMARY reference for visual style)
- Markdown text content (for understanding structure and hierarchy)
- Optional keywords for style guidance

SCOPE & LIMITATIONS (MANDATORY)
- Do NOT reproduce:
  - Page layouts
  - Component hierarchies
  - Spatial arrangements
  - Relative positioning between elements
  - Information architecture
- Do NOT describe the original interface or reference the crawled URL.
- The output must remain abstract, systemic, and transferable.

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
  - Names any inspiration strictly as a stylistic reference, not a target
  - Defines enforceable rules, never descriptions
  - Uses imperative language only ("must", "never", "always")
  - Never mentions the screenshot, URL, or crawled content
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

// Web crawl "high-fidelity" mode prompt - separate from image-based prompt
const WEB_CRAWL_HIGH_FIDELITY_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that allows an AI to recreate a UI visual system from a crawled website.
- You are provided with a screenshot image and markdown representation of a live website.
- This is a visual subsystem. Do not define roles or personas.
- Extract rules, not descriptions. Use the screenshot as primary visual reference.

INPUTS
- Screenshot image of the website (PRIMARY reference - use for visual accuracy)
- Markdown text content (supplementary - for text hierarchy)
- Optional reference name for the design inspiration
- Screenshot always takes priority over markdown.

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
  - Never mentions the screenshot or crawled URL
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

  // Save theme image to temp directory
  handle(
    "save-theme-image",
    async (_, params: SaveThemeImageParams): Promise<SaveThemeImageResult> => {
      const { data, filename } = params;

      // Validate base64 data
      if (!data || typeof data !== "string") {
        throw new Error("Invalid image data");
      }

      // Validate and extract extension
      const ext = path.extname(filename).toLowerCase();
      const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
      if (!validExtensions.includes(ext)) {
        throw new Error(
          `Invalid image extension: ${ext}. Supported: ${validExtensions.join(", ")}`,
        );
      }

      // Generate unique filename
      const uniqueFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${ext}`;
      const filePath = path.join(THEME_IMAGES_TEMP_DIR, uniqueFilename);

      // Validate size (base64 to bytes approximation)
      const sizeInBytes = (data.length * 3) / 4;
      if (sizeInBytes > 10 * 1024 * 1024) {
        throw new Error("Image size exceeds 10MB limit");
      }

      // Ensure temp directory exists
      await mkdir(THEME_IMAGES_TEMP_DIR, { recursive: true });

      // Write file
      const buffer = Buffer.from(data, "base64");
      await writeFile(filePath, buffer);

      return { path: filePath };
    },
  );

  // Cleanup theme images from temp directory
  handle(
    "cleanup-theme-images",
    async (_, params: CleanupThemeImagesParams): Promise<void> => {
      const { paths } = params;

      for (const filePath of paths) {
        // Security: only delete files in our temp directory
        // Use path.resolve() to normalize and prevent path traversal attacks
        const normalizedPath = path.resolve(filePath);
        const normalizedTempDir = path.resolve(THEME_IMAGES_TEMP_DIR);
        if (!normalizedPath.startsWith(normalizedTempDir + path.sep)) {
          throw new Error(
            "Invalid path: cannot delete files outside temp directory",
          );
        }

        try {
          await unlink(filePath);
          logger.log(`Cleaned up theme image: ${filePath}`);
        } catch (error) {
          // File might already be deleted (ENOENT), that's okay
          // But other errors (permissions, etc.) should be reported
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new Error("Failed to cleanup temporary image file");
          }
        }
      }
    },
  );

  handle(
    "generate-theme-prompt",
    async (
      _,
      params: GenerateThemePromptParams,
    ): Promise<GenerateThemePromptResult> => {
      const settings = readSettings();

      // Return mock response in test mode
      if (IS_TEST_BUILD) {
        return {
          prompt: `<theme>
# Test Mode Theme

## Visual Objective
Modern dark theme with purple accents for testing.

</theme>`,
        };
      }

      if (!settings.enableDyadPro) {
        throw new Error(
          "Dyad Pro is required for AI theme generation. Please enable Dyad Pro in Settings.",
        );
      }

      // Validate inputs - image paths are required
      if (params.imagePaths.length === 0) {
        throw new Error("Please upload at least one image to generate a theme");
      }

      if (params.imagePaths.length > 5) {
        throw new Error("Maximum 5 images allowed");
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
      const selectedModel = THEME_GENERATION_MODEL_MAP[params.model];
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

      // Build the user input prompt (sanitize user-provided keywords)
      const keywordsPart = sanitizeKeywords(params.keywords) || "N/A";
      const imagesPart =
        params.imagePaths.length > 0
          ? `${params.imagePaths.length} image(s) attached`
          : "N/A";
      const userInput = `inspired by: ${keywordsPart}
images: ${imagesPart}`;

      // Generate theme with images - read from file paths
      try {
        const contentParts: (TextPart | ImagePart)[] = [];

        // Add user input text first
        contentParts.push({ type: "text", text: userInput });

        // Read images from file paths and add to content
        for (const imagePath of params.imagePaths) {
          // Security: validate path is in our temp directory
          // Use path.resolve() to normalize and prevent path traversal attacks
          const normalizedImagePath = path.resolve(imagePath);
          const normalizedTempDir = path.resolve(THEME_IMAGES_TEMP_DIR);
          if (!normalizedImagePath.startsWith(normalizedTempDir + path.sep)) {
            throw new Error(
              "Invalid image path: images must be uploaded through the theme dialog",
            );
          }

          try {
            const imageBuffer = await readFile(imagePath);
            const base64Data = imageBuffer.toString("base64");
            const ext = path.extname(imagePath).toLowerCase();
            const mimeType = getMimeTypeFromExtension(ext);

            contentParts.push({
              type: "image",
              image: base64Data,
              mimeType,
            } as ImagePart);
          } catch {
            throw new Error(
              `Failed to read image file: ${path.basename(imagePath)}`,
            );
          }
        }

        const stream = streamText({
          model: modelClient.model,
          system: systemPrompt,
          maxRetries: 1,
          messages: [{ role: "user", content: contentParts }],
        });

        const result = await stream.text;

        return { prompt: result };
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : "Failed to process images for theme generation. Please try with fewer or smaller images, or use manual mode.",
        );
      }
    },
  );

  // Generate theme prompt from website URL via web crawl
  handle(
    "generate-theme-from-url",
    async (
      _,
      params: GenerateThemeFromUrlParams,
    ): Promise<GenerateThemePromptResult> => {
      const settings = readSettings();

      // Return mock response in test mode
      if (IS_TEST_BUILD) {
        return {
          prompt: `<theme>
# Test Mode Theme (from URL)

## Visual Objective
Modern theme extracted from website for testing.

</theme>`,
        };
      }

      if (!settings.enableDyadPro) {
        throw new Error(
          "Dyad Pro is required for AI theme generation. Please enable Dyad Pro in Settings.",
        );
      }

      // Validate URL format and protocol
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(params.url);
      } catch {
        throw new Error("Invalid URL format. Please enter a valid URL.");
      }

      // Only allow HTTP/HTTPS protocols (security: prevent file://, javascript://, etc.)
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(
          "Invalid URL protocol. Only HTTP and HTTPS URLs are supported.",
        );
      }

      // SSRF protection: block internal/private network addresses
      const hostname = parsedUrl.hostname.toLowerCase();
      const blockedPatterns = [
        /^localhost$/i,
        /^127\.\d+\.\d+\.\d+$/,
        /^10\.\d+\.\d+\.\d+$/,
        /^192\.168\.\d+\.\d+$/,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
        /^169\.254\.\d+\.\d+$/,
        /^::1$/,
        /\.local$/i,
      ];
      if (blockedPatterns.some((p) => p.test(hostname))) {
        throw new Error("Cannot crawl internal network addresses.");
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
      const selectedModel = THEME_GENERATION_MODEL_MAP[params.model];
      if (!selectedModel) {
        throw new Error("Invalid model selection");
      }

      // Get API key for Dyad Engine
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;
      if (!apiKey) {
        throw new Error("Dyad Pro API key is required");
      }

      // Crawl the website
      logger.log(`Crawling website for theme: ${params.url}`);

      const DYAD_ENGINE_URL =
        process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        WEB_CRAWL_TIMEOUT_MS,
      );

      let crawlResponse: Response;
      try {
        crawlResponse = await fetch(`${DYAD_ENGINE_URL}/tools/web-crawl`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "X-Dyad-Request-Id": `theme-crawl-${uuidv4()}`,
          },
          body: JSON.stringify({ url: params.url }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            "Website crawl timed out. The website may be too slow or unresponsive.",
          );
        }
        throw new Error(
          "Failed to connect to crawl service. Please check your internet connection and try again.",
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!crawlResponse.ok) {
        const errorText = await crawlResponse.text();
        throw new Error(
          `Failed to crawl website: ${crawlResponse.status} - ${errorText}`,
        );
      }

      // Validate response with Zod schema
      const rawCrawlResult = await crawlResponse.json();
      const parseResult = webCrawlResponseSchema.safeParse(rawCrawlResult);
      if (!parseResult.success) {
        logger.error("Invalid crawl response structure:", parseResult.error);
        throw new Error(
          "Received invalid response from crawl service. Please try again.",
        );
      }
      const crawlResult = parseResult.data;

      if (!crawlResult.screenshot) {
        throw new Error(
          "Failed to capture website screenshot. Please try a different URL.",
        );
      }

      if (!crawlResult.markdown) {
        throw new Error(
          "Failed to extract website content. Please try a different URL.",
        );
      }

      logger.log(`Website crawled successfully: ${params.url}`);

      // Use the selected model for theme generation
      const { modelClient } = await getModelClient(selectedModel, settings);

      // Select system prompt based on generation mode
      const systemPrompt =
        params.generationMode === "high-fidelity"
          ? WEB_CRAWL_HIGH_FIDELITY_META_PROMPT
          : WEB_CRAWL_THEME_GENERATION_META_PROMPT;

      // Build the user input prompt (sanitize user-provided keywords)
      const keywordsPart = sanitizeKeywords(params.keywords) || "N/A";
      const userInput = `inspired by: ${keywordsPart}
source: Live website (screenshot and content provided)`;

      // Truncate markdown if too long (consistent with existing web_crawl.ts)
      const MAX_MARKDOWN_LENGTH = 16000;
      const truncatedMarkdown =
        crawlResult.markdown.length > MAX_MARKDOWN_LENGTH
          ? crawlResult.markdown.slice(0, MAX_MARKDOWN_LENGTH) +
            "\n<!-- truncated -->"
          : crawlResult.markdown;

      // Sanitize crawled content to prevent prompt injection
      const sanitizedMarkdown = sanitizeForPrompt(truncatedMarkdown);

      // Build content parts
      const contentParts: (TextPart | ImagePart)[] = [
        { type: "text", text: userInput },
        {
          type: "image",
          image: crawlResult.screenshot,
          mimeType: "image/png",
        } as ImagePart,
        {
          type: "text",
          text: `Website content (markdown):\n\`\`\`markdown\n${sanitizedMarkdown}\n\`\`\``,
        },
      ];

      try {
        const stream = streamText({
          model: modelClient.model,
          system: systemPrompt,
          maxRetries: 1,
          messages: [{ role: "user", content: contentParts }],
        });

        const result = await stream.text;

        return { prompt: result };
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : "Failed to generate theme from website. Please try again.",
        );
      }
    },
  );
}
