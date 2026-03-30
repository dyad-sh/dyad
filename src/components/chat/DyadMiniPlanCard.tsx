import React, { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Sparkles,
  Check,
  Loader2,
  Palette,
  Layout,
  Paintbrush,
  Pencil,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { miniPlanStateAtom } from "@/atoms/miniPlanAtoms";
import {
  selectedChatIdAtom,
  chatMessagesByIdAtom,
  isStreamingByIdAtom,
  chatErrorByIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useTemplates } from "@/hooks/useTemplates";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useThemes } from "@/hooks/useThemes";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import type { MiniPlanEditableField } from "@/ipc/types/mini_plan";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";
import { MiniPlanUserPrompt } from "./MiniPlanUserPrompt";
import { MiniPlanDesignDirection } from "./MiniPlanDesignDirection";
import { MiniPlanVisuals } from "./MiniPlanVisuals";
import type { CustomTagState } from "./stateTypes";

interface DyadMiniPlanCardProps {
  node: {
    properties: {
      "app-name"?: string;
      appName?: string;
      template?: string;
      theme?: string;
      "design-direction"?: string;
      designDirection?: string;
      "main-color"?: string;
      mainColor?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export const DyadMiniPlanCard: React.FC<DyadMiniPlanCardProps> = ({ node }) => {
  const props = node.properties;
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const miniPlanState = useAtomValue(miniPlanStateAtom);
  const setMiniPlanState = useSetAtom(miniPlanStateAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const setIsStreamingById = useSetAtom(isStreamingByIdAtom);
  const setErrorById = useSetAtom(chatErrorByIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app, refreshApp } = useLoadApp(selectedAppId);
  const queryClient = useQueryClient();
  const { templates } = useTemplates();
  const { themes } = useThemes();
  const { customThemes } = useCustomThemes();

  const isApproved = chatId ? miniPlanState.approvedChatIds.has(chatId) : false;
  const planData = chatId ? miniPlanState.plansByChatId.get(chatId) : null;
  const isChatStreaming = chatId
    ? (isStreamingById.get(chatId) ?? false)
    : false;

  // Use atom data if available, fall back to XML attributes
  const appName = planData?.appName || props["app-name"] || props.appName || "";
  const templateId = planData?.templateId || props.template || "react";
  const themeId = planData?.themeId || props.theme || "default";
  const designDirection =
    planData?.designDirection ||
    props["design-direction"] ||
    props.designDirection ||
    "";
  const mainColor =
    planData?.mainColor || props["main-color"] || props.mainColor || "";
  const userPrompt = planData?.userPrompt || "";
  const attachments = planData?.attachments || [];
  const visuals = planData?.visuals || [];
  const allThemeOptions = [
    ...(themes ?? []).map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      isCustom: false,
    })),
    ...customThemes.map((theme) => ({
      id: `custom:${theme.id}`,
      name: theme.name,
      description: theme.description ?? "",
      isCustom: true,
    })),
  ];

  const isInProgress = props.state === "pending" || props.complete === "false";
  const inputIdPrefix = chatId ? `mini-plan-${chatId}` : "mini-plan";
  const appNameFieldId = `${inputIdPrefix}-app-name`;
  const templateFieldId = `${inputIdPrefix}-template`;
  const themeFieldId = `${inputIdPrefix}-theme`;
  const mainColorTextFieldId = `${inputIdPrefix}-main-color-text`;
  const mainColorPickerFieldId = `${inputIdPrefix}-main-color-picker`;

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const handleFieldEdit = useCallback(
    (field: MiniPlanEditableField, value: string) => {
      if (!chatId || isApproved) return;

      // Update local state immediately
      setMiniPlanState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, { ...existing, [field]: value });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process
      void ipc.miniPlan.editField({ chatId, field, value }).catch((error) => {
        console.error("Failed to persist mini plan field edit:", error);
        showError("Could not save mini plan changes. Please try again.");
      });
    },
    [chatId, isApproved, setMiniPlanState],
  );

  const handleApprove = useCallback(async () => {
    if (!chatId || isApproved) return;

    const plan = miniPlanState.plansByChatId.get(chatId);
    if (!plan) {
      showError("Mini plan data is unavailable. Please regenerate the plan.");
      return;
    }

    setIsApproving(true);
    setApprovalError(null);

    // Optimistically mark as approved so UI updates immediately
    setMiniPlanState((prev) => {
      const nextApproved = new Set(prev.approvedChatIds);
      nextApproved.add(chatId);
      return { ...prev, approvedChatIds: nextApproved };
    });
    try {
      await ipc.miniPlan.approve({ chatId });

      const applyErrors: string[] = [];
      const recordApplyError = (message: string, error: unknown) => {
        console.error(message, error);
        applyErrors.push(message);
      };

      // Apply plan settings to the app
      if (selectedAppId) {
        let currentApp = app;
        let templateApplied = false;

        if (!currentApp) {
          try {
            currentApp = await ipc.app.getApp(selectedAppId);
          } catch (error) {
            recordApplyError(
              "Could not load the app before applying the mini plan.",
              error,
            );
          }
        }

        // Rename the app if the name differs (keep existing folder path)
        if (currentApp && plan.appName && plan.appName !== currentApp.name) {
          try {
            await ipc.app.renameApp({
              appId: selectedAppId,
              appName: plan.appName,
              appPath: currentApp.path,
            });
          } catch (error) {
            recordApplyError("Could not rename the app.", error);
          }
        }

        try {
          const { applied } = await ipc.template.applyAppTemplate({
            appId: selectedAppId,
            templateId: plan.templateId,
            chatId: chatId ?? undefined,
          });
          templateApplied = applied;
        } catch (error) {
          recordApplyError("Could not apply the selected template.", error);
        }

        // Set the theme if it differs
        try {
          const currentTheme = await ipc.template.getAppTheme({
            appId: selectedAppId,
          });
          if (plan.themeId !== (currentTheme ?? "default")) {
            await ipc.template.setAppTheme({
              appId: selectedAppId,
              themeId: plan.themeId,
            });
          }
        } catch (error) {
          recordApplyError("Could not apply the selected theme.", error);
        }

        if (templateApplied) {
          try {
            await ipc.app.restartApp({
              appId: selectedAppId,
              removeNodeModules: true,
            });
          } catch (error) {
            recordApplyError(
              "Could not restart the app after the template change.",
              error,
            );
          }
        }

        // Refresh app data so the sidebar/header reflect the new name
        await Promise.all([
          refreshApp(),
          queryClient.invalidateQueries({ queryKey: queryKeys.apps.all }),
        ]);
      }

      if (applyErrors.length > 0) {
        const errorMessage = `Mini plan approved, but some changes could not be applied:\n- ${applyErrors.join("\n- ")}`;
        setApprovalError(errorMessage);
        showError(errorMessage);
      }

      const visualsSummary =
        plan.visuals.length > 0
          ? plan.visuals
              .map(
                (v) => `- ${v.type}: ${v.description}\n  Prompt: ${v.prompt}`,
              )
              .join("\n")
          : "No visuals planned";

      const templateName =
        templates?.find((t) => t.id === plan.templateId)?.title ??
        plan.templateId;
      const themeName =
        allThemeOptions.find((t) => t.id === plan.themeId)?.name ??
        plan.themeId;

      const miniPlanContext = [
        `[Mini Plan Approved]`,
        `App Name: ${plan.appName}`,
        `Template: ${templateName} (${plan.templateId})`,
        `Theme: ${themeName} (${plan.themeId})`,
        `Main Color: ${plan.mainColor}`,
        `Design Direction: ${plan.designDirection}`,
        ``,
        `Visual Assets:`,
        visualsSummary,
        ``,
        `Original Prompt: ${plan.userPrompt}`,
      ].join("\n");

      // Set streaming state
      setIsStreamingById((prev) => {
        const next = new Map(prev);
        next.set(chatId, true);
        return next;
      });

      // Clear any previous errors
      setErrorById((prev) => {
        const next = new Map(prev);
        next.set(chatId, null);
        return next;
      });

      // Send the approved plan as a follow-up message to start building
      ipc.chatStream.start(
        {
          chatId,
          prompt: miniPlanContext,
          attachments: plan.attachments.map((a) => ({
            name: a.split("/").pop() || a,
            type: "application/octet-stream",
            data: "",
            attachmentType: "chat-context" as const,
          })),
          selectedComponents: [],
        },
        {
          onChunk: ({
            messages: updatedMessages,
            streamingMessageId,
            streamingContent,
          }) => {
            if (updatedMessages) {
              setMessagesById((prev) => {
                const next = new Map(prev);
                next.set(chatId, updatedMessages);
                return next;
              });
            } else if (
              streamingMessageId !== undefined &&
              streamingContent !== undefined
            ) {
              setMessagesById((prev) => {
                const existingMessages = prev.get(chatId);
                if (!existingMessages) return prev;
                const next = new Map(prev);
                const updated = existingMessages.map((msg) =>
                  msg.id === streamingMessageId
                    ? { ...msg, content: streamingContent }
                    : msg,
                );
                next.set(chatId, updated);
                return next;
              });
            }
          },
          onEnd: () => {
            setIsStreamingById((prev) => {
              const next = new Map(prev);
              next.set(chatId, false);
              return next;
            });
          },
          onError: ({ error }) => {
            console.error("Mini plan implementation stream error:", error);
            setErrorById((prev) => {
              const next = new Map(prev);
              next.set(chatId, error);
              return next;
            });
            setIsStreamingById((prev) => {
              const next = new Map(prev);
              next.set(chatId, false);
              return next;
            });
          },
        },
      );
    } catch (error) {
      console.error("Failed to approve mini plan:", error);
      setMiniPlanState((prev) => {
        const nextApproved = new Set(prev.approvedChatIds);
        nextApproved.delete(chatId);
        return { ...prev, approvedChatIds: nextApproved };
      });
      setApprovalError("Failed to approve the mini plan. Please try again.");
      showError("Failed to approve the mini plan. Please try again.");
    } finally {
      setIsApproving(false);
    }
  }, [
    chatId,
    isApproved,
    miniPlanState,
    templates,
    themes,
    customThemes,
    selectedAppId,
    app,
    refreshApp,
    queryClient,
    setMiniPlanState,
    setMessagesById,
    setIsStreamingById,
    setErrorById,
  ]);

  const handleNameSubmit = useCallback(() => {
    setEditingName(false);
    if (nameValue.trim() && nameValue !== appName) {
      handleFieldEdit("appName", nameValue.trim());
    } else {
      setNameValue(appName);
    }
  }, [nameValue, appName, handleFieldEdit]);

  return (
    <div
      className={`my-4 border rounded-lg overflow-hidden transition-colors ${
        isInProgress
          ? "border-primary/60"
          : isApproved
            ? "border-emerald-500/30 bg-emerald-50/5"
            : "border-primary/20"
      } bg-card`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles
            className={`text-primary ${isInProgress ? "animate-pulse" : ""}`}
            size={18}
          />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Mini Plan
          </span>
        </div>
        {isInProgress && (
          <span className="flex items-center gap-1.5 text-xs text-primary px-3 py-1 bg-primary/10 rounded-md font-medium">
            <Loader2 size={12} className="animate-spin" />
            Generating...
          </span>
        )}
      </div>

      {/* Progress bar during generation */}
      {isInProgress && (
        <div className="px-4 py-1.5">
          <div
            className="h-1 w-full rounded-full overflow-hidden"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.3) 50%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-3 space-y-4">
        {/* App Name */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            App Name
          </div>
          {editingName && !isApproved ? (
            <input
              id={appNameFieldId}
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSubmit();
                if (e.key === "Escape") {
                  setNameValue(appName);
                  setEditingName(false);
                }
              }}
              aria-label="App Name"
              className="block w-full text-lg font-semibold bg-transparent border-b border-primary/40 focus:border-primary outline-none pb-0.5 text-foreground"
              autoFocus
            />
          ) : (
            <button
              id={appNameFieldId}
              type="button"
              aria-label="Edit app name"
              title={isApproved ? undefined : "Edit app name"}
              className={`group inline-flex items-center gap-1 text-lg font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm ${
                !isApproved
                  ? "hover:text-primary cursor-text transition-colors"
                  : ""
              }`}
              onClick={() => {
                if (!isApproved) {
                  setNameValue(appName);
                  setEditingName(true);
                }
              }}
              disabled={isApproved}
            >
              <span>{appName || "Untitled App"}</span>
              {!isApproved && (
                <Pencil
                  size={14}
                  className="text-muted-foreground/70 transition-colors group-hover:text-primary group-focus-visible:text-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          )}
        </div>

        {/* User Prompt */}
        {userPrompt && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Prompt
            </div>
            <MiniPlanUserPrompt prompt={userPrompt} attachments={attachments} />
          </div>
        )}

        {/* Tech Stack & Theme Row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Tech Stack */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Layout size={10} />
              Tech Stack
            </div>
            {isApproved ? (
              <span className="text-sm text-foreground/80">
                {templates?.find((t) => t.id === templateId)?.title ??
                  templateId}
              </span>
            ) : (
              <select
                id={templateFieldId}
                aria-label="Tech Stack"
                data-testid="mini-plan-template-select"
                value={templateId}
                onChange={(e) => handleFieldEdit("templateId", e.target.value)}
                className="w-full text-sm bg-background border border-border/50 rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Theme */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Paintbrush size={10} />
              Theme
            </div>
            {isApproved ? (
              <span className="text-sm text-foreground/80">
                {allThemeOptions.find((t) => t.id === themeId)?.name ?? themeId}
              </span>
            ) : (
              <select
                id={themeFieldId}
                aria-label="Theme"
                data-testid="mini-plan-theme-select"
                value={themeId}
                onChange={(e) => handleFieldEdit("themeId", e.target.value)}
                className="w-full text-sm bg-background border border-border/50 rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {(themes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                {customThemes.length > 0 && (
                  <optgroup label="Custom Themes">
                    {customThemes.map((t) => (
                      <option key={`custom:${t.id}`} value={`custom:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>
        </div>

        {/* Main Color */}
        {mainColor && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Palette size={10} />
              Main Color
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-md border border-border/50 shrink-0"
                style={{ backgroundColor: mainColor }}
              />
              {isApproved ? (
                <span className="text-sm text-foreground/80 font-mono">
                  {mainColor}
                </span>
              ) : (
                <input
                  id={mainColorTextFieldId}
                  type="text"
                  aria-label="Main Color Hex Code"
                  value={mainColor}
                  onChange={(e) => handleFieldEdit("mainColor", e.target.value)}
                  className="text-sm font-mono bg-background border border-border/50 rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-28"
                  placeholder="#000000"
                />
              )}
              {!isApproved && (
                <input
                  id={mainColorPickerFieldId}
                  type="color"
                  aria-label="Main Color Picker"
                  value={mainColor}
                  onChange={(e) => handleFieldEdit("mainColor", e.target.value)}
                  className="w-7 h-7 p-0 border-0 bg-transparent cursor-pointer"
                />
              )}
            </div>
          </div>
        )}

        {/* Design Direction */}
        {designDirection && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Design Direction
            </div>
            <MiniPlanDesignDirection direction={designDirection} />
          </div>
        )}

        {/* Visuals */}
        {(visuals.length > 0 || isInProgress) && (
          <div className="space-y-1">
            <MiniPlanVisuals
              visuals={visuals}
              state={isInProgress ? "pending" : "finished"}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      {appName && (
        <div
          className={`px-4 py-3 border-t border-border/50 flex gap-3 ${
            approvalError ? "items-start justify-between" : "justify-end"
          }`}
        >
          {approvalError && (
            <p className="max-w-md text-xs text-destructive whitespace-pre-wrap">
              {approvalError}
            </p>
          )}
          {isApproved ? (
            <span
              className={`flex items-center gap-1.5 text-sm font-medium ${
                approvalError
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {isApproving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Applying plan...
                </>
              ) : approvalError ? (
                <>
                  <AlertCircle size={16} className="text-amber-500" />
                  Plan approved with issues
                </>
              ) : (
                <>
                  <Check size={16} className="text-emerald-500" />
                  Plan approved
                </>
              )}
            </span>
          ) : (
            <button
              type="button"
              onClick={handleApprove}
              disabled={isInProgress || isApproving || isChatStreaming}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground px-5 py-2 bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isInProgress ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generating plan...
                </>
              ) : isApproving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Applying plan...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Approve Plan
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
