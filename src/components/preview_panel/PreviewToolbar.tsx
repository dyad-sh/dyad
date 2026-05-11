import { useAtom, useAtomValue } from "jotai";
import {
  type PreviewMode,
  previewModeAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import {
  AlertTriangle,
  Code,
  Eye,
  Globe,
  MoreHorizontal,
  Shield,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PRIMARY_MODES = [
  "preview",
  "code",
  "publish",
] as const satisfies readonly Exclude<PreviewMode, "plan">[];
const OVERFLOW_MODES = [
  "configure",
  "problems",
  "security",
] as const satisfies readonly Exclude<PreviewMode, "plan">[];
const COMPACT_TOOLBAR_THRESHOLD = 700;

interface ModeButtonsProps {
  isCompact: boolean;
}

const PreviewToolbarModeButtons = ({ isCompact }: ModeButtonsProps) => {
  const { t } = useTranslation("home");
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { problemReport } = useCheckProblems(selectedAppId);

  const problemCount = problemReport ? problemReport.problems.length : 0;
  const displayCount =
    problemCount === 0
      ? ""
      : problemCount > 100
        ? "100+"
        : problemCount.toString();

  const selectPanel = (panel: PreviewMode) => {
    if (previewMode === panel && isPreviewOpen) {
      setIsPreviewOpen(false);
      return;
    }
    setPreviewMode(panel);
    if (!isPreviewOpen) {
      setIsPreviewOpen(true);
    }
  };

  type ToolbarMode = Exclude<PreviewMode, "plan">;
  const modeMeta: Record<
    ToolbarMode,
    { icon: React.ReactNode; label: string; testId: string }
  > = {
    preview: {
      icon: <Eye size={16} />,
      label: t("preview.title"),
      testId: "preview-mode-button",
    },
    problems: {
      icon: <AlertTriangle size={16} />,
      label: t("preview.problems"),
      testId: "problems-mode-button",
    },
    code: {
      icon: <Code size={16} />,
      label: t("preview.code"),
      testId: "code-mode-button",
    },
    configure: {
      icon: <Wrench size={16} />,
      label: t("preview.configure"),
      testId: "configure-mode-button",
    },
    security: {
      icon: <Shield size={16} />,
      label: t("preview.security"),
      testId: "security-mode-button",
    },
    publish: {
      icon: <Globe size={16} />,
      label: t("preview.publish"),
      testId: "publish-mode-button",
    },
  };

  const renderButton = (mode: ToolbarMode) => {
    const meta = modeMeta[mode];
    const isActive = previewMode === mode && isPreviewOpen;
    const badge =
      mode === "problems" && displayCount ? (
        <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
          {displayCount}
        </span>
      ) : null;
    return (
      <Tooltip key={mode}>
        <TooltipTrigger
          render={
            <button
              data-testid={meta.testId}
              aria-label={meta.label}
              aria-pressed={isActive}
              className={cn(
                "no-app-region-drag cursor-pointer relative flex items-center justify-center gap-1.5 p-1.5 rounded-md transition-colors",
                isActive
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-2"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
              )}
              onClick={() => selectPanel(mode)}
            />
          }
        >
          {meta.icon}
          {isActive && (
            <span className="text-sm font-medium">{meta.label}</span>
          )}
          {badge}
        </TooltipTrigger>
        <TooltipContent>{meta.label}</TooltipContent>
      </Tooltip>
    );
  };

  const visibleModes: readonly ToolbarMode[] = isCompact
    ? PRIMARY_MODES
    : [...PRIMARY_MODES, ...OVERFLOW_MODES];
  const isOverflowActive =
    (OVERFLOW_MODES as readonly PreviewMode[]).includes(previewMode) &&
    isPreviewOpen;
  const showOverflowProblemBadge = isCompact && !!displayCount;

  return (
    <div className="flex items-center gap-0.5">
      {visibleModes.map((mode) => renderButton(mode))}
      {isCompact && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  data-testid="preview-mode-overflow-button"
                  aria-label={t("preview.moreOptions")}
                  className={cn(
                    "no-app-region-drag cursor-pointer relative flex items-center justify-center p-1.5 rounded-md transition-colors",
                    isOverflowActive
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
                  )}
                />
              }
            >
              <MoreHorizontal size={16} />
              {showOverflowProblemBadge && (
                <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
                  {displayCount}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>{t("preview.moreOptions")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            {OVERFLOW_MODES.map((mode) => {
              const meta = modeMeta[mode];
              return (
                <DropdownMenuItem
                  key={mode}
                  data-testid={meta.testId}
                  onClick={() => selectPanel(mode)}
                >
                  {meta.icon}
                  <span>{meta.label}</span>
                  {mode === "problems" && displayCount && (
                    <span className="ml-auto px-1.5 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
                      {displayCount}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

interface PreviewToolbarProps {
  children?: React.ReactNode;
}

export const PreviewToolbar = ({ children }: PreviewToolbarProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompact(entry.contentRect.width < COMPACT_TOOLBAR_THRESHOLD);
      }
    });
    observer.observe(node);
    setIsCompact(
      node.getBoundingClientRect().width < COMPACT_TOOLBAR_THRESHOLD,
    );
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex items-center p-2 border-b gap-3">
      <PreviewToolbarModeButtons isCompact={isCompact} />
      {children && (
        <div className="flex flex-1 items-center space-x-2 min-w-0">
          {children}
        </div>
      )}
    </div>
  );
};
