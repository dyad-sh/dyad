import fs from "node:fs";
import * as path from "path";
import log from "electron-log";
import type { ChatMode, UserSettings } from "@/lib/schemas";
import {
  isBasicAgentMode,
  isSupabaseConnected,
  isTurboEditsV2Enabled,
} from "@/lib/schemas";
import { constructSystemPrompt, readAiRules } from "@/prompts/system_prompt";
import {
  getSupabaseAvailableSystemPrompt,
  SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT,
} from "@/prompts/supabase_prompt";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "@/prompts/summarize_chat_system_prompt";
import { SECURITY_REVIEW_SYSTEM_PROMPT } from "@/prompts/security_review_prompt";
import {
  getSupabaseContext,
  getSupabaseClientCode,
} from "@/supabase_admin/supabase_context";
import { buildNeonPromptForApp } from "@/neon_admin/neon_prompt_context";
import { detectFrameworkType } from "../utils/framework_utils";
import { getThemePromptById } from "../utils/theme_utils";
import type { AttachmentDeliveryConfig } from "../utils/chat_attachment_utils";
import type { MentionedAppCodebaseEntry } from "../utils/mention_apps";

const logger = log.scope("chat_system_prompt_builder");

export interface ChatSystemPromptApp {
  id: number;
  path: string;
  themeId: string | null;
  supabaseProjectId: string | null;
  supabaseOrganizationSlug: string | null;
  neonProjectId: string | null;
  neonActiveBranchId: string | null;
  neonDevelopmentBranchId: string | null;
  needsAppBlueprint: boolean;
}

export interface ChatSystemPromptResult {
  systemPrompt: string;
  /** Reused by ask/plan mode prompt reconstruction. */
  aiRules: string;
  themePrompt: string;
  frameworkType: ReturnType<typeof detectFrameworkType>;
  isSecurityReviewIntent: boolean;
  isSummarizeIntent: boolean;
}

/**
 * Assembles the system prompt for a build-mode chat turn (Phase 2 extraction
 * from chat_stream_handlers.ts): base prompt from chat mode + AI rules +
 * theme, referenced-app notes, special intents (security review, summarize),
 * Supabase/Neon integration context, and attachment delivery instructions.
 */
export async function buildChatSystemPrompt({
  app,
  appPath,
  settings,
  selectedChatMode,
  requestPrompt,
  mentionedAppsCodebases,
  otherAppsCodebaseInfo,
  attachmentDeliveryConfig,
}: {
  app: ChatSystemPromptApp;
  appPath: string;
  settings: UserSettings;
  selectedChatMode: ChatMode;
  requestPrompt: string;
  mentionedAppsCodebases: MentionedAppCodebaseEntry[];
  otherAppsCodebaseInfo: string;
  attachmentDeliveryConfig: AttachmentDeliveryConfig;
}): Promise<ChatSystemPromptResult> {
  const aiRules = await readAiRules(appPath);

  // Get theme prompt for the app (null themeId means "no theme")
  const themePrompt = await getThemePromptById(app.themeId);
  logger.log(
    `Theme for app ${app.id}: ${app.themeId ?? "none"}, prompt length: ${themePrompt.length} chars`,
  );

  const frameworkType = detectFrameworkType(appPath);

  // Migration on read converts "agent" to "build", so no need to check for it here
  let systemPrompt = constructSystemPrompt({
    aiRules,
    chatMode: selectedChatMode,
    enableTurboEditsV2: isTurboEditsV2Enabled(settings),
    themePrompt,
    basicAgentMode: isBasicAgentMode(settings),
    frameworkType,
    hasSupabaseProject: !!app.supabaseProjectId,
    enableAppBlueprint: settings.enableAppBlueprint && app.needsAppBlueprint,
  });

  // Add information about mentioned apps for build mode only.
  // Full codebase injection (build mode): full file contents already
  // concatenated into `otherAppsCodebaseInfo`.
  //
  // Agent/ask/plan modes don't need anything in the system prompt —
  // handleLocalAgentStream injects a `<system-reminder>` into the
  // user's latest message so the system prompt stays static.
  if (otherAppsCodebaseInfo) {
    const mentionedAppsList = mentionedAppsCodebases
      .map(({ appName }) => appName)
      .join(", ");

    systemPrompt += `\n\n# Referenced Apps\nThe user has mentioned the following apps in their prompt: ${mentionedAppsList}. Their codebases have been included in the context for your reference. When referring to these apps, you can understand their structure and code to provide better assistance, however you should NOT edit the files in these referenced apps. The referenced apps are NOT part of the current app and are READ-ONLY.`;
  }

  const isSecurityReviewIntent = requestPrompt.startsWith("/security-review");
  if (isSecurityReviewIntent) {
    systemPrompt = SECURITY_REVIEW_SYSTEM_PROMPT;
    try {
      const rulesPath = path.join(appPath, "SECURITY_RULES.md");
      let securityRules = "";

      await fs.promises.access(rulesPath);
      securityRules = await fs.promises.readFile(rulesPath, "utf8");

      if (securityRules && securityRules.trim().length > 0) {
        systemPrompt +=
          "\n\n# Project-specific security rules:\n" + securityRules;
      }
    } catch (error) {
      // Best-effort: if reading rules fails, continue without them
      logger.info("Failed to read security rules", error);
    }
  }

  if (app.supabaseProjectId && isSupabaseConnected(settings)) {
    const supabaseClientCode = await getSupabaseClientCode({
      projectId: app.supabaseProjectId,
      organizationSlug: app.supabaseOrganizationSlug ?? null,
    });
    systemPrompt +=
      "\n\n" +
      getSupabaseAvailableSystemPrompt(supabaseClientCode) +
      "\n\n" +
      // For local agent, we will explicitly fetch the database context when needed.
      (selectedChatMode === "local-agent"
        ? ""
        : await getSupabaseContext({
            supabaseProjectId: app.supabaseProjectId,
            organizationSlug: app.supabaseOrganizationSlug ?? null,
          }));
  } else if (app.neonProjectId) {
    // Neon is connected — inject Neon prompt instead of Supabase
    systemPrompt +=
      "\n\n" +
      (await buildNeonPromptForApp({
        appPath: app.path,
        neonProjectId: app.neonProjectId!,
        neonActiveBranchId: app.neonActiveBranchId,
        neonDevelopmentBranchId: app.neonDevelopmentBranchId,
        selectedChatMode,
      })) +
      "\n\n";
  } else if (
    // In local agent mode, we will suggest integrations as part of the add-integration tool
    selectedChatMode !== "local-agent" &&
    // If in security review mode, we don't need to mention integrations are available.
    !isSecurityReviewIntent
  ) {
    systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
  }
  const isSummarizeIntent = requestPrompt.startsWith("Summarize from chat-id=");
  if (isSummarizeIntent) {
    systemPrompt = SUMMARIZE_CHAT_SYSTEM_PROMPT;
  }

  if (attachmentDeliveryConfig.addSystemCopyInstructions) {
    systemPrompt += `

When files are attached to this conversation for upload to the codebase, copy them into the project using this exact format:

<dyad-copy from="/absolute/path/to/.dyad/media/source.ext" to="path/to/destination/filename.ext" description="Upload file to codebase"></dyad-copy>

Use the attached file path from the user's message as the \`from\` value. Choose an appropriate project-relative \`to\` path.

`;
  }

  if (attachmentDeliveryConfig.addSystemVisionInstructions) {
    systemPrompt += `

# Image Analysis Instructions
This conversation includes one or more image attachments. When the user uploads images:
1. If the user explicitly asks for analysis, description, or information about the image, please analyze the image content.
2. Describe what you see in the image if asked.
3. You can use images as references when the user has coding or design-related questions.
4. For diagrams or wireframes, try to understand the content and structure shown.
5. For screenshots of code or errors, try to identify the issue or explain the code.
`;
  }

  return {
    systemPrompt,
    aiRules,
    themePrompt,
    frameworkType,
    isSecurityReviewIntent,
    isSummarizeIntent,
  };
}
