import { useAtom, useAtomValue } from "jotai";
import {
  type PreviewMode,
  previewModeAtom,
  selectedAppIdAtom,
  selectedVersionIdAtom,
} from "@/atoms/appAtoms";
import { isChatPanelHiddenAtom, isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import {
  AlertTriangle,
  Code,
  Diff,
  Eye,
  FlaskConical,
  Globe,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Shield,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
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
import { useReducedMotionPref } from "@/hooks/useReducedMotion";

type ToolbarMode = Exclude<PreviewMode, "plan">;

const TAB_ORDER = [
  "preview",
  "code",
  "publish",
  "configure",
  "problems",
  "security",
  "tests",
] as const satisfies readonly ToolbarMode[];
const VERSION_TAB_ORDER = ["preview", "code"] as const satisfies readonly [
  ToolbarMode,
  ToolbarMode,
];

const TAB_GAP_PX = 4;
const ACTIVE_TAB_SPRING = {
  type: "spring" as const,
  stiffness: 800,
  damping: 40,
  mass: 0.5,
};

// Every tab shares one size-affecting style so a tab's width never changes
// when it becomes active — the overflow math depends on stable widths.
const TAB_BASE_CLASSES =
  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap";

const problemBadgeClasses =
  "px-1 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center";

/**
 * Decides which tabs fit in the row. Tabs keep canonical order; when space
 * runs out, the trailing tabs collapse into the overflow menu — except the
 * active tab, which always stays visible by swapping into the last slot.
 */
export function computeVisibleTabs<T extends string>({
  order,
  active,
  widths,
  availableWidth,
  gap,
  overflowWidth,
}: {
  order: readonly T[];
  active: T | null;
  widths: Partial<Record<T, number>>;
  availableWidth: number;
  gap: number;
  overflowWidth: number;
}): { visible: T[]; hidden: T[] } {
  const widthOf = (mode: T) => widths[mode] ?? 0;
  const totalAll = order.reduce(
    (sum, mode, index) => sum + widthOf(mode) + (index > 0 ? gap : 0),
    0,
  );
  if (totalAll <= availableWidth) {
    return { visible: [...order], hidden: [] };
  }

  // Reserve room for the "…" button (plus the gap before it).
  const budget = availableWidth - overflowWidth - gap;
  const visible: T[] = [];
  let used = 0;
  for (const mode of order) {
    const next = used + (visible.length > 0 ? gap : 0) + widthOf(mode);
    if (next > budget) {
      break;
    }
    visible.push(mode);
    used = next;
  }

  if (active && order.includes(active) && !visible.includes(active)) {
    const activeWidth = widthOf(active);
    while (visible.length > 0 && used + gap + activeWidth > budget) {
      const removed = visible.pop()!;
      used -= widthOf(removed) + (visible.length > 0 ? gap : 0);
    }
    // Even if the active tab alone doesn't fit, it must stay visible.
    visible.push(active);
  }

  return {
    visible,
    hidden: order.filter((mode) => !visible.includes(mode)),
  };
}

export const PreviewToolbar = () => {
  const { t, i18n } = useTranslation("home");
  const reducedMotion = useReducedMotionPref();
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedVersionId = useAtomValue(selectedVersionIdAtom);
  const isVersionSelected = selectedVersionId != null;
  const { problemReport } = useCheckProblems(selectedAppId);

  // When a version is selected, only the preview/diff panels are available.
  // Coerce a stale previewMode (e.g. "configure", "problems") to the preview
  // view so the toolbar and rendered panel don't diverge.
  useEffect(() => {
    if (
      isVersionSelected &&
      previewMode !== "preview" &&
      previewMode !== "code"
    ) {
      setPreviewMode("preview");
    }
  }, [isVersionSelected, previewMode, setPreviewMode]);

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
      icon: isVersionSelected ? <Diff size={16} /> : <Code size={16} />,
      label: isVersionSelected ? t("preview.diff") : t("preview.code"),
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
    tests: {
      icon: <FlaskConical size={16} />,
      label: t("preview.tests"),
      testId: "tests-mode-button",
    },
    publish: {
      icon: <Globe size={16} />,
      label: t("preview.publish"),
      testId: "publish-mode-button",
    },
  };

  const tabOrder: readonly ToolbarMode[] = isVersionSelected
    ? VERSION_TAB_ORDER
    : TAB_ORDER;

  // Overflow needs real pixel widths (labels vary by locale), so an invisible
  // replica of every tab is measured and the visible set computed from that.
  const tabsAreaRef = useRef<HTMLDivElement>(null);
  const measureRefs = useRef(new Map<ToolbarMode, HTMLElement>());
  const overflowMeasureRef = useRef<HTMLDivElement>(null);
  const [tabWidths, setTabWidths] = useState<Partial<
    Record<ToolbarMode, number>
  > | null>(null);
  const [overflowWidth, setOverflowWidth] = useState(0);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    // Round widths up (and available width down, below) so a fractional-pixel
    // rounding error can never overflow the row.
    const widths: Partial<Record<ToolbarMode, number>> = {};
    for (const [mode, el] of measureRefs.current) {
      widths[mode] = Math.ceil(el.getBoundingClientRect().width);
    }
    setTabWidths(widths);
    setOverflowWidth(
      Math.ceil(overflowMeasureRef.current?.getBoundingClientRect().width ?? 0),
    );
  }, [isVersionSelected, i18n.language]);

  useLayoutEffect(() => {
    const node = tabsAreaRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setAvailableWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(node);
    setAvailableWidth(Math.floor(node.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  const activeTab = (tabOrder as readonly PreviewMode[]).includes(previewMode)
    ? (previewMode as ToolbarMode)
    : null;
  const { visible, hidden } =
    tabWidths && availableWidth != null
      ? computeVisibleTabs({
          order: tabOrder,
          active: activeTab,
          widths: tabWidths,
          availableWidth,
          gap: TAB_GAP_PX,
          overflowWidth,
        })
      : { visible: [...tabOrder], hidden: [] as ToolbarMode[] };

  const renderTab = (mode: ToolbarMode) => {
    const meta = modeMeta[mode];
    const isActive = previewMode === mode && isPreviewOpen;
    const tabContent = (
      <>
        {isActive && (
          <motion.span
            layoutId="preview-toolbar-active-tab"
            aria-hidden="true"
            className="absolute inset-0 rounded-md bg-primary/10 dark:bg-purple-900/40"
            initial={false}
            transition={reducedMotion ? { duration: 0 } : ACTIVE_TAB_SPRING}
          />
        )}
        <span className="relative z-10 flex items-center gap-1.5">
          {meta.icon}
          <span>{meta.label}</span>
        </span>
        {mode === "problems" && displayCount && (
          <span
            className={cn("absolute -top-1 -right-1 z-20", problemBadgeClasses)}
          >
            {displayCount}
          </span>
        )}
      </>
    );
    const tabClassName = cn(
      "no-app-region-drag relative cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      TAB_BASE_CLASSES,
      isActive
        ? "text-primary dark:text-purple-300"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    );

    return (
      <button
        key={mode}
        data-testid={meta.testId}
        aria-label={meta.label}
        aria-pressed={isActive}
        className={tabClassName}
        onClick={() => selectPanel(mode)}
      >
        {tabContent}
      </button>
    );
  };

  const showOverflowProblemBadge =
    hidden.includes("problems") && !!displayCount;

  return (
    <div className="flex items-center gap-2 border-b p-2">
      <div
        ref={tabsAreaRef}
        className="relative flex min-w-0 flex-1 items-center gap-1"
      >
        {visible.map((mode) => renderTab(mode))}
        {hidden.length > 0 && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    data-testid="preview-mode-overflow-button"
                    aria-label={t("preview.moreOptions")}
                    className="no-app-region-drag cursor-pointer relative flex items-center justify-center rounded-md p-1.5 text-gray-700 transition-colors hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                  />
                }
              >
                <MoreHorizontal size={16} />
                {showOverflowProblemBadge && (
                  <span
                    className={cn(
                      "absolute -top-1 -right-1",
                      problemBadgeClasses,
                    )}
                  >
                    {displayCount}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent>{t("preview.moreOptions")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              {hidden.map((mode) => {
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
                      <span className={cn("ml-auto", problemBadgeClasses)}>
                        {displayCount}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Invisible measurement replica: same size-affecting classes and
            content as real tabs so offsetWidth matches. */}
        <div
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1"
        >
          {tabOrder.map((mode) => {
            const meta = modeMeta[mode];
            return (
              <div
                key={mode}
                ref={(el) => {
                  if (el) {
                    measureRefs.current.set(mode, el);
                  } else {
                    measureRefs.current.delete(mode);
                  }
                }}
                className={TAB_BASE_CLASSES}
              >
                {meta.icon}
                <span>{meta.label}</span>
              </div>
            );
          })}
          <div
            ref={overflowMeasureRef}
            className="flex items-center justify-center p-1.5"
          >
            <MoreHorizontal size={16} />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center border-l border-border pl-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => setIsChatPanelHidden(!isChatPanelHidden)}
                aria-label={
                  isChatPanelHidden
                    ? t("preview.chatToggle.show")
                    : t("preview.chatToggle.hide")
                }
                aria-pressed={isChatPanelHidden}
                className="no-app-region-drag cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                data-testid="preview-toggle-chat-panel-button"
              />
            }
          >
            {isChatPanelHidden ? (
              <Maximize2 size={16} />
            ) : (
              <Minimize2 size={16} />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {isChatPanelHidden
              ? t("preview.chatToggle.show")
              : t("preview.chatToggle.hide")}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
