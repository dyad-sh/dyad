import React, { useState, useCallback, useEffect, useRef } from "react";
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
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useTemplates } from "@/hooks/useTemplates";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useThemes } from "@/hooks/useThemes";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import type {
  MiniPlanEditableField,
  MiniPlanVisualEditableField,
  MiniPlanVisual,
} from "@/ipc/types/mini_plan";
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
      template?: string;
      theme?: string;
      "design-direction"?: string;
      "main-color"?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
}

export const DyadMiniPlanCard: React.FC<DyadMiniPlanCardProps> = ({ node }) => {
  const props = node.properties;
  const chatId = useAtomValue(selectedChatIdAtom);
  const miniPlanState = useAtomValue(miniPlanStateAtom);
  const setMiniPlanState = useSetAtom(miniPlanStateAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app, refreshApp } = useLoadApp(selectedAppId);
  const queryClient = useQueryClient();
  const { templates } = useTemplates();
  const { themes } = useThemes();
  const { customThemes } = useCustomThemes();

  const isApproved = chatId ? miniPlanState.approvedChatIds.has(chatId) : false;
  const planData = chatId ? miniPlanState.plansByChatId.get(chatId) : null;
  const isTimedOut = chatId ? miniPlanState.timedOutChatIds.has(chatId) : false;
  // Use atom data if available, fall back to XML attributes. Preserve
  // intentionally empty user edits (e.g. cleared app name) by checking for
  // live plan data presence rather than truthiness of individual fields.
  const appName =
    planData != null ? planData.appName : (props["app-name"] ?? "");
  const templateId =
    planData != null ? planData.templateId : (props.template ?? "react");
  const themeId =
    planData != null ? planData.themeId : (props.theme ?? "default");
  const designDirection =
    planData != null
      ? planData.designDirection
      : (props["design-direction"] ?? "");
  const mainColor =
    planData != null ? planData.mainColor : (props["main-color"] ?? "");
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

  // The XML tag's `complete` attribute is the definitive signal that the
  // agent finished emitting the plan. Don't gate readiness on a separate
  // visuals-update event — if the agent skips `plan_visuals` or the event
  // never arrives, the card would otherwise stay permanently disabled.
  const isReady = props.state !== "pending" && props.complete !== "false";
  const inputIdPrefix = chatId ? `mini-plan-${chatId}` : "mini-plan";
  const appNameFieldId = `${inputIdPrefix}-app-name`;
  const templateFieldId = `${inputIdPrefix}-template`;
  const themeFieldId = `${inputIdPrefix}-theme`;
  const mainColorTextFieldId = `${inputIdPrefix}-main-color-text`;
  const mainColorPickerFieldId = `${inputIdPrefix}-main-color-picker`;
  const statusId = `${inputIdPrefix}-status`;

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [colorTextValue, setColorTextValue] = useState(mainColor);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  // Synchronous guard against fast double-clicks on Approve — `isApproving`
  // state wouldn't see a second click within the same render tick.
  const approvingRef = useRef(false);

  // Sync local state when props change (e.g. from streaming updates)
  useEffect(() => {
    if (!editingName) {
      setNameValue(appName);
    }
  }, [appName, editingName]);

  useEffect(() => {
    setColorTextValue(mainColor);
  }, [mainColor]);

  const handleVisualEdit = useCallback(
    (visualId: string, field: MiniPlanVisualEditableField, value: string) => {
      if (!chatId || isApproved) return;

      // Update local state immediately
      setMiniPlanState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, {
            ...existing,
            visuals: existing.visuals.map((v) =>
              v.id === visualId ? { ...v, [field]: value } : v,
            ),
          });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process
      void ipc.miniPlan
        .editVisual({ chatId, visualId, field, value })
        .catch((error) => {
          console.error("Failed to persist visual edit:", error);
          showError("Could not save visual changes. Please try again.");
        });
    },
    [chatId, isApproved, setMiniPlanState],
  );

  const handleAddVisual = useCallback(
    (visual: Omit<MiniPlanVisual, "id">) => {
      if (!chatId || isApproved) return;

      // Generate a temporary ID for optimistic update
      const tempId = `visual_${Date.now().toString(36)}`;

      // Update local state immediately
      setMiniPlanState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, {
            ...existing,
            visuals: [...existing.visuals, { ...visual, id: tempId }],
          });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process and update with real ID
      void ipc.miniPlan
        .addVisual({ chatId, ...visual })
        .then(({ visualId }) => {
          if (visualId && visualId !== tempId) {
            setMiniPlanState((prev) => {
              const nextPlans = new Map(prev.plansByChatId);
              const existing = nextPlans.get(chatId);
              if (existing) {
                nextPlans.set(chatId, {
                  ...existing,
                  visuals: existing.visuals.map((v) =>
                    v.id === tempId ? { ...v, id: visualId } : v,
                  ),
                });
              }
              return { ...prev, plansByChatId: nextPlans };
            });
          }
        })
        .catch((error) => {
          console.error("Failed to add visual:", error);
          showError("Could not add visual. Please try again.");
          // Roll back optimistic update
          setMiniPlanState((prev) => {
            const nextPlans = new Map(prev.plansByChatId);
            const existing = nextPlans.get(chatId);
            if (existing) {
              nextPlans.set(chatId, {
                ...existing,
                visuals: existing.visuals.filter((v) => v.id !== tempId),
              });
            }
            return { ...prev, plansByChatId: nextPlans };
          });
        });
    },
    [chatId, isApproved, setMiniPlanState],
  );

  const handleRemoveVisual = useCallback(
    (visualId: string) => {
      if (!chatId || isApproved) return;

      // Capture for rollback before mutating state — reading inside the
      // updater is unsafe because React may invoke updaters more than once.
      const removedVisual = miniPlanState.plansByChatId
        .get(chatId)
        ?.visuals.find((v) => v.id === visualId);
      if (!removedVisual) return;

      // Update local state immediately
      setMiniPlanState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, {
            ...existing,
            visuals: existing.visuals.filter((v) => v.id !== visualId),
          });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process
      void ipc.miniPlan.removeVisual({ chatId, visualId }).catch((error) => {
        console.error("Failed to remove visual:", error);
        showError("Could not remove visual. Please try again.");
        // Roll back
        setMiniPlanState((prev) => {
          const nextPlans = new Map(prev.plansByChatId);
          const existing = nextPlans.get(chatId);
          if (existing) {
            nextPlans.set(chatId, {
              ...existing,
              visuals: [...existing.visuals, removedVisual],
            });
          }
          return { ...prev, plansByChatId: nextPlans };
        });
      });
    },
    [chatId, isApproved, miniPlanState, setMiniPlanState],
  );

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
    if (approvingRef.current) return;

    const plan = miniPlanState.plansByChatId.get(chatId);
    if (!plan) {
      showError("Mini plan data is unavailable. Please regenerate the plan.");
      return;
    }

    approvingRef.current = true;
    setIsApproving(true);
    setApprovalError(null);

    // Optimistically mark as approved so UI updates immediately
    setMiniPlanState((prev) => {
      const nextApproved = new Set(prev.approvedChatIds);
      nextApproved.add(chatId);
      return { ...prev, approvedChatIds: nextApproved };
    });
    try {
      const applyErrors: string[] = [];
      let templateApplyFailed = false;
      const recordApplyError = (message: string, error: unknown) => {
        console.error(message, error);
        const detail =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : undefined;
        applyErrors.push(detail ? `${message} (${detail})` : message);
      };

      // Apply plan settings to the app before resolving the agent's promise
      if (selectedAppId) {
        let currentApp = app;
        let templateNeedsRestart = false;

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
          const { needsRestart } = await ipc.template.applyAppTemplate({
            appId: selectedAppId,
            templateId: plan.templateId,
            chatId: chatId ?? undefined,
          });
          templateNeedsRestart = needsRestart;
        } catch (error) {
          templateApplyFailed = true;
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

        if (templateNeedsRestart) {
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

      // Template application is the critical step — if it failed, don't
      // unblock the agent so the user can fix the plan and re-approve.
      // The agent would otherwise build for the wrong framework.
      if (templateApplyFailed) {
        setMiniPlanState((prev) => {
          const nextApproved = new Set(prev.approvedChatIds);
          nextApproved.delete(chatId);
          return { ...prev, approvedChatIds: nextApproved };
        });
        const errorMessage = `Could not apply the selected template. Please review the plan and try again:\n- ${applyErrors.join("\n- ")}`;
        setApprovalError(errorMessage);
        showError(errorMessage);
        return;
      }

      if (applyErrors.length > 0) {
        const errorMessage = `Mini plan approved, but some changes could not be applied:\n- ${applyErrors.join("\n- ")}`;
        setApprovalError(errorMessage);
        showError(errorMessage);
      }

      // Approve the plan — this resolves the agent's blocking promise
      // so it can continue in the existing stream (no new chatStream.start needed)
      await ipc.miniPlan.approve({ chatId });
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
      approvingRef.current = false;
    }
  }, [
    chatId,
    isApproved,
    miniPlanState,
    selectedAppId,
    app,
    refreshApp,
    queryClient,
    setMiniPlanState,
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
      aria-busy={!isReady}
      className={`my-4 border rounded-lg overflow-hidden transition-colors ${
        !isReady
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
            className={`text-primary ${!isReady ? "animate-pulse" : ""}`}
            size={18}
          />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Mini Plan
          </span>
        </div>
        {!isReady && (
          <span className="flex items-center gap-1.5 text-xs text-primary px-3 py-1 bg-primary/10 rounded-md font-medium">
            <Loader2 size={12} className="animate-spin" />
            Generating...
          </span>
        )}
      </div>

      {/* Progress bar during generation */}
      {!isReady && (
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                {!(templates ?? []).some((t) => t.id === templateId) && (
                  <option value={templateId} disabled>
                    Unknown template ({templateId})
                  </option>
                )}
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
                {!allThemeOptions.some((t) => t.id === themeId) && (
                  <option value={themeId} disabled>
                    Unknown theme ({themeId})
                  </option>
                )}
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
        {(mainColor || !isApproved) && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Palette size={10} />
              Main Color
            </div>
            <div className="flex items-center gap-2">
              {mainColor && (
                <div
                  className="w-7 h-7 rounded-md border border-border/50 shrink-0"
                  style={{ backgroundColor: mainColor }}
                />
              )}
              {isApproved ? (
                <span className="text-sm text-foreground/80 font-mono">
                  {mainColor}
                </span>
              ) : (
                <input
                  id={mainColorTextFieldId}
                  type="text"
                  aria-label="Main Color Hex Code"
                  value={colorTextValue}
                  onChange={(e) => setColorTextValue(e.target.value)}
                  onBlur={() => {
                    if (/^#[0-9a-fA-F]{6}$/.test(colorTextValue)) {
                      handleFieldEdit("mainColor", colorTextValue);
                    } else {
                      setColorTextValue(mainColor);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="text-sm font-mono bg-background border border-border/50 rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-28"
                  placeholder="#000000"
                />
              )}
              {!isApproved && (
                <input
                  id={mainColorPickerFieldId}
                  type="color"
                  aria-label="Main Color Picker"
                  value={mainColor || "#000000"}
                  onChange={(e) => {
                    setColorTextValue(e.target.value);
                    handleFieldEdit("mainColor", e.target.value);
                  }}
                  className="w-7 h-7 p-0 border-0 bg-transparent cursor-pointer"
                />
              )}
            </div>
          </div>
        )}

        {/* Design Direction */}
        {(designDirection || !isApproved) && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Design Direction
            </div>
            <MiniPlanDesignDirection
              direction={designDirection}
              isApproved={isApproved}
              onEdit={(value) => handleFieldEdit("designDirection", value)}
            />
          </div>
        )}

        {/* Visuals */}
        {(visuals.length > 0 || !isReady) && (
          <div className="space-y-1">
            <MiniPlanVisuals
              visuals={visuals}
              state={isReady ? "finished" : "pending"}
              isApproved={isApproved}
              onEditVisual={handleVisualEdit}
              onAddVisual={handleAddVisual}
              onRemoveVisual={handleRemoveVisual}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`px-4 py-3 border-t border-border/50 flex gap-3 items-start justify-between`}
      >
        {isApproved ? (
          <>
            {approvalError && (
              <p className="max-w-md text-xs text-destructive whitespace-pre-wrap">
                {approvalError}
              </p>
            )}
            <span
              className={`ml-auto flex items-center gap-1.5 text-sm font-medium ${
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
          </>
        ) : (
          <>
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              className={`max-w-md text-xs ${
                isTimedOut
                  ? "text-destructive font-medium"
                  : isReady
                    ? "text-emerald-600 dark:text-emerald-400 font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {isTimedOut
                ? "Plan timed out — start a new chat to try again."
                : isReady
                  ? "Your mini plan is ready to review."
                  : "Preparing mini plan..."}
            </p>
            <button
              type="button"
              onClick={handleApprove}
              disabled={!isReady || !appName || isApproving || isTimedOut}
              aria-describedby={statusId}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground px-5 py-2 bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApproving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Applying plan...
                </>
              ) : isTimedOut ? (
                "Plan timed out"
              ) : !isReady ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generating...
                </>
              ) : !appName ? (
                "Add an app name to continue"
              ) : (
                <>
                  <Check size={14} />
                  Approve Plan
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
