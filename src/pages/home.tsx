import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { homeChatInputValueAtom } from "../atoms/chatAtoms";
import { selectedAppIdAtom, homeModeAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { generateCuteAppName } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSettings } from "@/hooks/useSettings";
import { SetupBanner } from "@/components/SetupBanner";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useState, useEffect, useCallback } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { usePostHog } from "posthog-js/react";
import { PrivacyBanner } from "@/components/TelemetryBanner";
import { INSPIRATION_PROMPTS } from "@/prompts/inspiration_prompts";
import { useAppVersion } from "@/hooks/useAppVersion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { ImportAppButton } from "@/components/ImportAppButton";
import { showError } from "@/lib/toast";
import { invalidateAppQuery } from "@/hooks/useLoadApp";
import { useQueryClient } from "@tanstack/react-query";
import { ForceCloseDialog } from "@/components/ForceCloseDialog";

import type { FileAttachment } from "@/ipc/ipc_types";
import {
  NEON_TEMPLATE_IDS,
  contractTranslationTemplates,
} from "@/shared/templates";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { ProBanner } from "@/components/ProBanner";
import { MultiChainTranslationCard } from "@/components/MultiChainTranslationCard";
import { generateTranslationPrompt } from "@/prompts/translation_prompts";
import { BLOCKCHAIN_LANGUAGES } from "@/lib/blockchain_languages_registry";
import { CreateAppDialog } from "@/components/CreateAppDialog";

// Adding an export for attachments
export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
  customName?: string;
  isContractProject?: boolean;
  prompt?: string;
  existingAppId?: number; // For pre-created apps (e.g., Solana scaffold)
}

export default function HomePage() {
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { refreshApps } = useLoadApps();
  const { settings, updateSettings } = useSettings();
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [isLoading, setIsLoading] = useState(false);
  const [forceCloseDialogOpen, setForceCloseDialogOpen] = useState(false);
  const [performanceData, setPerformanceData] = useState<any>(undefined);
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const posthog = usePostHog();
  const appVersion = useAppVersion();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState("");
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  // Listen for force-close events
  useEffect(() => {
    const ipc = IpcClient.getInstance();
    const unsubscribe = ipc.onForceCloseDetected((data) => {
      setPerformanceData(data.performanceData);
      setForceCloseDialogOpen(true);
    });
    return () => unsubscribe();
  }, []);

  const [mode] = useAtom(homeModeAtom);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<
    string | undefined
  >();
  useEffect(() => {
    const updateLastVersionLaunched = async () => {
      if (
        appVersion &&
        settings &&
        settings.lastShownReleaseNotesVersion !== appVersion
      ) {
        const shouldShowReleaseNotes = !!settings.lastShownReleaseNotesVersion;
        await updateSettings({
          lastShownReleaseNotesVersion: appVersion,
        });
        // It feels spammy to show release notes if it's
        // the users very first time.
        if (!shouldShowReleaseNotes) {
          return;
        }

        try {
          const result = await IpcClient.getInstance().doesReleaseNoteExist({
            version: appVersion,
          });

          if (result.exists && result.url) {
            setReleaseUrl(result.url + "?hideHeader=true&theme=" + theme);
            setReleaseNotesOpen(true);
          }
        } catch (err) {
          console.warn(
            "Unable to check if release note exists for: " + appVersion,
            err,
          );
        }
      }
    };
    updateLastVersionLaunched();
  }, [appVersion, settings, updateSettings, theme]);

  // Get the appId from search params
  const appId = search.appId ? Number(search.appId) : null;

  // State for random prompts
  const [randomPrompts, setRandomPrompts] = useState<
    typeof INSPIRATION_PROMPTS
  >([]);

  // Function to get random prompts
  const getRandomPrompts = useCallback(() => {
    const shuffled = [...INSPIRATION_PROMPTS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
  }, []);

  // Initialize random prompts
  useEffect(() => {
    setRandomPrompts(getRandomPrompts());
  }, [getRandomPrompts]);

  // Redirect to app details page if appId is present
  useEffect(() => {
    if (appId) {
      navigate({ to: "/app-details", search: { appId } });
    }
  }, [appId, navigate]);

  const handleTranslate = async (
    code: string,
    attachments: any[],
    projectName: string,
    sourceLanguage: string,
    targetLanguage: string,
  ) => {
    // Extract contract name based on source language
    let extractedName: string | undefined;
    if (sourceLanguage === "solidity" || sourceLanguage === "vyper") {
      // Solidity/Vyper: contract ContractName
      extractedName = code.match(/contract\s+(\w+)/)?.[1]?.toLowerCase();
    } else if (sourceLanguage === "sui_move" || sourceLanguage === "aptos_move") {
      // Move: module package::module_name
      extractedName = code.match(/module\s+\w+::(\w+)/)?.[1]?.toLowerCase();
    } else if (sourceLanguage === "solana_rust") {
      // Rust: Look for program name in lib.rs
      extractedName = code.match(/declare_id!\("([^"]+)"\)/)?.[1]?.split("::")[0]?.toLowerCase();
    }

    // Generate final name with target language suffix
    const targetSuffix = targetLanguage.replace(/_/g, "-");
    const finalName =
      projectName.trim() ||
      (extractedName ? `${extractedName}-${targetSuffix}` : `translated-${targetSuffix}`);

    console.log("handleTranslate - sourceLanguage:", sourceLanguage);
    console.log("handleTranslate - targetLanguage:", targetLanguage);
    console.log("handleTranslate - projectName:", projectName);
    console.log("handleTranslate - extractedName:", extractedName);
    console.log("handleTranslate - finalName:", finalName);

    // Try shinso-transpiler for Solidity → Sui Move token standards
    let transpilerUsed = false;
    let suiAppId: number | undefined;
    let writtenFiles: string[] = [];

    console.log("🔍 Transpiler check:", {
      sourceLanguage,
      targetLanguage,
      hasCode: !!code.trim(),
      codeLength: code.length,
    });

    if (sourceLanguage === "solidity" && targetLanguage === "sui_move" && code.trim()) {
      console.log("✅ Conditions met for transpiler check");

      // Detect ERC20 or ERC721 patterns in the code
      const hasERC20 = /ERC20|IERC20|function\s+transfer\s*\(|function\s+balanceOf\s*\(/i.test(code);
      const hasERC721 = /ERC721|IERC721|function\s+ownerOf\s*\(|function\s+tokenURI\s*\(/i.test(code);

      console.log("🔍 Token detection:", {
        hasERC20,
        hasERC721,
        erc20Matches: code.match(/ERC20|IERC20|function\s+transfer\s*\(|function\s+balanceOf\s*\(/gi),
        erc721Matches: code.match(/ERC721|IERC721|function\s+ownerOf\s*\(|function\s+tokenURI\s*\(/gi),
      });

      if (hasERC20 || hasERC721) {
        const tokenType = hasERC721 ? "erc721" : "erc20";
        console.log(`✨ Detected ${tokenType.toUpperCase()} contract, using shinso-transpiler...`);

        try {
          setIsLoading(true);

          // Create the app first to get the output path
          console.log("📦 Creating Sui Move app...");
          const createResult = await IpcClient.getInstance().createApp({
            name: finalName,
            isContractProject: true,
          });
          suiAppId = createResult.app.id;
          console.log(`✅ Created app with ID: ${suiAppId}, path: ${createResult.app.path}`);

          // Run transpiler directly to the app directory
          // Backend will resolve the relative path to absolute
          console.log("📡 Calling transpiler with direct output to app directory");
          console.log("  Token type:", tokenType);
          console.log("  Output path:", createResult.app.path);

          const result = await IpcClient.getInstance().transpileContract({
            code,
            tokenType,
            compile: false,
            outputPath: createResult.app.path, // Backend will resolve to absolute path
          });

          console.log("📥 Transpiler result:", {
            success: result.success,
            filesCount: result.files?.length || 0,
            files: result.files,
            error: result.error,
          });

          if (result.success && result.files) {
            transpilerUsed = true;
            writtenFiles = result.files;
            console.log("✅ Shinso transpiler succeeded!");
            console.log(`\n✅ Successfully transpiled ${writtenFiles.length} file(s):`);
            console.table(writtenFiles.map((f, i) => ({
              '#': i + 1,
              'File': f,
              'Location': f === 'Move.toml' ? `src/${finalName}` : `src/${finalName}/sources`
            })));

            if (result.stdout) console.log("Transpiler stdout:", result.stdout);
          } else {
            console.warn("❌ Shinso transpiler failed:", result.error);
            if (result.stderr) console.warn("Transpiler stderr:", result.stderr);

            // Check for common unsupported features
            const errorStr = result.error || "";
            if (errorStr.includes("InlineAssembly")) {
              console.info("ℹ️ Transpiler doesn't support inline assembly yet. Falling back to LLM translation.");
            } else if (errorStr.includes("unknown variant")) {
              console.info("ℹ️ Transpiler doesn't support this Solidity feature yet. Falling back to LLM translation.");
            }
          }
        } catch (error) {
          console.warn("⚠️ Shinso transpiler error, falling back to LLM:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        console.log("⚠️ No ERC20/ERC721 patterns detected, skipping transpiler");
      }
    } else {
      console.log("⚠️ Transpiler conditions not met:", {
        isRightLanguagePair: sourceLanguage === "solidity" && targetLanguage === "sui_move",
        hasCode: !!code.trim(),
      });
    }

    // If target is Solana, scaffold the Anchor project first
    let solanaAppId: number | undefined;
    if (targetLanguage === "solana_rust") {
      try {
        setIsLoading(true);
        console.log("Scaffolding Anchor project:", finalName);

        const result = await IpcClient.getInstance().solanaInitProject({
          projectName: finalName,
          parentPath: "src",
        });

        if (!result.success) {
          console.error("Failed to scaffold Anchor project:", result.error);
          // Show error to user
          return;
        }

        console.log("Anchor project scaffolded successfully with app ID:", result.appId);
        solanaAppId = result.appId;
      } catch (error) {
        console.error("Error scaffolding Anchor project:", error);
        // Show error to user
        return;
      } finally {
        setIsLoading(false);
      }
    }

    // Get the dynamic translation prompt for this language pair
    const basePrompt = generateTranslationPrompt(sourceLanguage, targetLanguage);

    // For Solana, add specific file path instruction
    const solanaPathInstruction = targetLanguage === "solana_rust"
      ? `\n\n**IMPORTANT**: The Anchor project has been initialized at \`src/${finalName}/\`.

Write the translated contract to:
\`\`\`
src/${finalName}/programs/${finalName}/src/lib.rs
\`\`\`

Use this exact path in your <dyad-write> tag.`
      : "";

    // Create the complete translation prompt with the user's code
    let translationPrompt: string;

    if (transpilerUsed && suiAppId && writtenFiles.length > 0) {
      console.log("🎯 Using transpiler - files already written to codebase");
      // Files have been written - ask LLM to review and improve
      const helperFiles = writtenFiles.filter(f => f.match(/^(i8|i16|i32|i64|i128|i256|map)\.move$/));
      const contractFiles = writtenFiles.filter(f => !f.match(/^(i8|i16|i32|i64|i128|i256|map)\.move$/));

      const fileList = [
        ...(helperFiles.length > 0 ? [`- Helper modules: ${helperFiles.map(f => `\`${f}\``).join(', ')}`] : []),
        ...(contractFiles.length > 0 ? [`- Main contract(s): ${contractFiles.map(f => `\`${f}\``).join(', ')}`] : []),
      ].join('\n');

      translationPrompt = `${basePrompt}

---

## ✅ Automatic Transpilation Completed

**Project Name:** ${finalName}

The Solidity contract has been **automatically transpiled** to Sui Move using shinso-transpiler and **all ${writtenFiles.length} files have been written to the codebase** in \`src/${finalName}/sources/\`.

**Files created:**
${fileList}

**Your Task:**
1. **Review the transpiled code** - Check the files in \`src/${finalName}/sources/\`
2. **Verify correctness** - Ensure it implements the Solidity contract's functionality properly
3. **Add tests** - Create comprehensive test cases in a test file
4. **Optimize** - Improve gas efficiency and code quality where needed
5. **Document** - Add/improve inline comments and module documentation
6. **Enhance** - Add any missing features, better error handling, or security improvements

**Original Solidity Contract (for reference):**
\`\`\`solidity
${code}
\`\`\`

**Next Steps:**
- Review the existing transpiled files
- Create a test file (e.g., \`src/${finalName}/tests/${extractedName || 'contract'}_tests.move\`)
- Add any improvements or missing functionality
- Ensure the code compiles and tests pass

The transpiled code is already in the codebase. Focus on review, testing, and enhancement rather than rewriting.`;
    } else {
      console.log("📝 Using standard LLM translation (no transpiler output)");
      // Standard LLM translation (no transpiler or transpiler failed)
      const contractSource = code.trim()
        ? code
        : attachments.length > 0
          ? `**See attached ${BLOCKCHAIN_LANGUAGES[sourceLanguage]?.fileExtension || 'source'} files for the contract code.**`
          : '';

      translationPrompt = `${basePrompt}

---

## Contract to Translate:

**Project Name:** ${finalName}${solanaPathInstruction}

${contractSource}

---

Please translate this ${BLOCKCHAIN_LANGUAGES[sourceLanguage]?.displayName || sourceLanguage} contract to ${BLOCKCHAIN_LANGUAGES[targetLanguage]?.displayName || targetLanguage} following the guidelines above. Provide a complete, working implementation with inline comments explaining key translation decisions.${attachments.length > 0 ? '\n\n**Note:** The source contract code is provided in the attached files. Please read and translate the attached contract files.' : ''}`;
    }

    // For Solana, use the full path since anchor init creates it in src/
    const appPath = targetLanguage === "solana_rust"
      ? `src/${finalName}`
      : finalName;

    // Submit immediately with the translation prompt passed directly
    await handleSubmit({
      attachments,
      customName: appPath,
      isContractProject: true,
      prompt: translationPrompt,
      existingAppId: solanaAppId || suiAppId, // Pass the app ID from scaffold/transpiler
    });
  };

  const handleSubmit = async (options?: HomeSubmitOptions) => {
    const attachments = options?.attachments || [];
    // Use provided prompt or fall back to inputValue
    const prompt = options?.prompt || inputValue;

    if (!prompt.trim() && attachments.length === 0) return;

    try {
      setIsLoading(true);
      // Create the chat and navigate
      // Use custom name if provided, otherwise generate cute name
      const appName = options?.customName || generateCuteAppName();

      console.log("handleSubmit - options:", options);
      console.log("handleSubmit - appName:", appName);
      console.log(
        "handleSubmit - isContractProject:",
        options?.isContractProject,
      );
      console.log("handleSubmit - existingAppId:", options?.existingAppId);

      let appId: number;
      let chatId: number;

      // If app already exists (e.g., Solana scaffold), use it
      if (options?.existingAppId) {
        appId = options.existingAppId;
        chatId = await IpcClient.getInstance().createChat(appId);
        console.log("Using existing app:", appId, "with new chat:", chatId);
      } else {
        // Create new app and chat
        const result = await IpcClient.getInstance().createApp({
          name: appName,
          isContractProject: options?.isContractProject,
        });
        appId = result.app.id;
        chatId = result.chatId;

        if (
          settings?.selectedTemplateId &&
          NEON_TEMPLATE_IDS.has(settings.selectedTemplateId)
        ) {
          await neonTemplateHook({
            appId: result.app.id,
            appName: result.app.name,
          });
        }
      }

      // Stream the message with attachments
      streamMessage({
        prompt: prompt,
        chatId: chatId,
        attachments,
      });
      await new Promise((resolve) =>
        setTimeout(resolve, settings?.isTestMode ? 0 : 2000),
      );

      setInputValue("");
      setSelectedAppId(appId);
      setIsPreviewOpen(false);
      await refreshApps(); // Ensure refreshApps is awaited if it's async
      await invalidateAppQuery(queryClient, { appId: appId });
      posthog.capture("home:chat-submit");
      navigate({ to: "/chat", search: { id: chatId } });
    } catch (error) {
      console.error("Failed to create app/chat:", error);
      showError("Failed to create app. " + (error as any).toString());
      setIsLoading(false); // Ensure loading state is reset on error
    }
    // No finally block needed for setIsLoading(false) here if navigation happens on success
  };

  // Loading overlay for app creation
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center max-w-3xl m-auto p-8">
        <div className="w-full flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute top-0 left-0 w-full h-full border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-8 border-t-primary rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-gray-200">
            Building your app
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-8">
            We're setting up your app with AI magic. <br />
            This might take a moment...
          </p>
        </div>
      </div>
    );
  }

  // Main Home Page Content
  return (
    <div className="flex flex-col items-center justify-center max-w-3xl w-full m-auto p-8">
      <ForceCloseDialog
        isOpen={forceCloseDialogOpen}
        onClose={() => setForceCloseDialogOpen(false)}
        performanceData={performanceData}
      />
      <SetupBanner />

      <div className="w-full space-y-6">
        {mode === "translate" ? (
          /* Code Translation Section */
          <>
            <MultiChainTranslationCard onTranslate={handleTranslate} />

            {/* ERC Template Quick Access */}
            <div className="mt-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 text-center">
                Or start with a standard ERC contract
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {contractTranslationTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setIsCreateDialogOpen(true);
                    }}
                    className="relative flex flex-col items-center gap-3 p-6 rounded-xl
                               border-2 border-primary/20
                               bg-black
                               transition-all duration-200
                               hover:border-primary hover:shadow-lg hover:shadow-primary/20
                               active:scale-[0.98]
                               group"
                  >
                    <div className="absolute inset-0 bg-primary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
                    <div className="relative text-4xl">
                      {template.contractIcon}
                    </div>
                    <div className="relative text-center">
                      <div className="font-semibold text-white mb-1">
                        {template.title}
                      </div>
                      <div className="text-sm text-gray-400">
                        {template.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* App Generation Section */}
            <ImportAppButton />
            <HomeChatInput onSubmit={handleSubmit} />

            <div className="flex flex-col gap-4 mt-2">
              <div className="flex flex-wrap gap-4 justify-center">
                {randomPrompts.map((item, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => setInputValue(`Build me a ${item.label}`)}
                    className="flex items-center gap-3 px-4 py-2 rounded-xl border border-gray-200
                               bg-white/50 backdrop-blur-sm
                               transition-all duration-200
                               hover:bg-white hover:shadow-md hover:border-gray-300
                               active:scale-[0.98]
                               dark:bg-gray-800/50 dark:border-gray-700
                               dark:hover:bg-gray-800 dark:hover:border-gray-600"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {item.icon}
                    </span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setRandomPrompts(getRandomPrompts())}
                className="self-center flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200
                           bg-white/50 backdrop-blur-sm
                           transition-all duration-200
                           hover:bg-white hover:shadow-md hover:border-gray-300
                           active:scale-[0.98]
                           dark:bg-gray-800/50 dark:border-gray-700
                           dark:hover:bg-gray-800 dark:hover:border-gray-600"
              >
                <svg
                  className="w-5 h-5 text-gray-700 dark:text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  More ideas
                </span>
              </button>
            </div>
            <ProBanner />
          </>
        )}
      </div>
      <PrivacyBanner />

      {/* Release Notes Dialog */}
      <Dialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}>
        <DialogContent className="max-w-4xl bg-(--docs-bg) pr-0 pt-4 pl-4 gap-1">
          <DialogHeader>
            <DialogTitle>What's new in v{appVersion}?</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-10 top-2 focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={() =>
                window.open(
                  releaseUrl.replace("?hideHeader=true&theme=" + theme, ""),
                  "_blank",
                )
              }
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </DialogHeader>
          <div className="overflow-auto h-[70vh] flex flex-col ">
            {releaseUrl && (
              <div className="flex-1">
                <iframe
                  src={releaseUrl}
                  className="w-full h-full border-0 rounded-lg"
                  title={`Release notes for v${appVersion}`}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ERC Template Creation Dialog */}
      <CreateAppDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        template={contractTranslationTemplates.find(
          (t) => t.id === selectedTemplateId,
        )}
      />
    </div>
  );
}
