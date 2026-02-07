import React, { useEffect, useState } from "react";
import { ChevronRight, Loader2, CircleX, CheckCircle2 } from "lucide-react";
import { CustomTagState } from "./stateTypes";

/**
 * Accent color configuration for DyadCard components.
 * Maps to Tailwind color classes for border, background, and text.
 */
export type DyadAccentColor =
  | "blue"
  | "purple"
  | "violet"
  | "red"
  | "amber"
  | "green"
  | "emerald"
  | "teal"
  | "sky"
  | "indigo"
  | "slate";

const ACCENT_BORDER: Record<DyadAccentColor, string> = {
  blue: "border-l-blue-500",
  purple: "border-l-purple-500",
  violet: "border-l-violet-500",
  red: "border-l-red-500",
  amber: "border-l-amber-500",
  green: "border-l-green-500",
  emerald: "border-l-emerald-500",
  teal: "border-l-teal-500",
  sky: "border-l-sky-500",
  indigo: "border-l-indigo-500",
  slate: "border-l-slate-400",
};

const ACCENT_ICON_BG: Record<DyadAccentColor, string> = {
  blue: "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400",
  purple:
    "bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400",
  violet:
    "bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400",
  red: "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400",
  amber: "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400",
  green: "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400",
  emerald:
    "bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400",
  teal: "bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400",
  sky: "bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400",
  indigo:
    "bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400",
  slate: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
};

const ACCENT_BADGE: Record<DyadAccentColor, string> = {
  blue: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800",
  purple:
    "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 ring-purple-200 dark:ring-purple-800",
  violet:
    "bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800",
  red: "bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-800",
  amber:
    "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800",
  green:
    "bg-green-50 dark:bg-green-950/60 text-green-700 dark:text-green-300 ring-green-200 dark:ring-green-800",
  emerald:
    "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800",
  teal: "bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 ring-teal-200 dark:ring-teal-800",
  sky: "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-800",
  indigo:
    "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800",
  slate:
    "bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700",
};

// -- DyadCard --

interface DyadCardProps {
  children: React.ReactNode;
  state?: CustomTagState;
  accentColor?: DyadAccentColor;
  showAccent?: boolean;
  variant?: "default" | "ghost";
  onClick?: () => void;
  isExpanded?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * Premium container for all Dyad markdown action cards.
 * Provides consistent borders, backgrounds, hover states, and a colored
 * left-accent border when the action is pending or aborted (or when
 * `showAccent` is explicitly set).
 *
 * When `onClick` is provided, the card behaves as an interactive button
 * with keyboard support (Enter/Space) and appropriate ARIA attributes.
 */
export function DyadCard({
  children,
  state,
  accentColor = "blue",
  showAccent,
  variant = "default",
  onClick,
  isExpanded,
  className = "",
  ...props
}: DyadCardProps) {
  const isPending = state === "pending";
  const isAborted = state === "aborted";

  const shouldShowAccent = showAccent ?? (isPending || isAborted);
  const leftBorder = shouldShowAccent
    ? `border-l-[3px] ${isAborted ? "border-l-red-500" : ACCENT_BORDER[accentColor]}`
    : "";

  const variantClasses =
    variant === "ghost"
      ? "hover:bg-(--background-lightest) rounded-lg"
      : `bg-(--background-lightest) hover:bg-(--background-lighter) rounded-xl border border-border/60 ${leftBorder}`;

  return (
    <div
      className={`
        group/card
        ${variantClasses}
        my-1.5 transition-colors duration-150
        ${onClick ? "cursor-pointer" : ""}
        ${className}
      `}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-expanded={
        onClick && isExpanded !== undefined ? isExpanded : undefined
      }
      onKeyDown={
        onClick
          ? (e) => {
              if (
                (e.key === "Enter" || e.key === " ") &&
                e.target === e.currentTarget
              ) {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      {...props}
    >
      {children}
    </div>
  );
}

// -- DyadCardHeader --

interface DyadCardHeaderProps {
  icon: React.ReactNode;
  accentColor?: DyadAccentColor;
  children?: React.ReactNode;
}

/**
 * Header row for DyadCard. Contains a tinted icon circle and flexible content area.
 */
export function DyadCardHeader({
  icon,
  accentColor = "blue",
  children,
}: DyadCardHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div
        className={`flex items-center justify-center size-7 rounded-lg shrink-0 ${ACCENT_ICON_BG[accentColor]}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

// -- DyadBadge --

interface DyadBadgeProps {
  children: React.ReactNode;
  color?: DyadAccentColor;
}

/**
 * Small pill badge for labeling card types (e.g. "GREP", "Turbo Edit", "SQL").
 */
export function DyadBadge({ children, color = "blue" }: DyadBadgeProps) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset ${ACCENT_BADGE[color]}`}
    >
      {children}
    </span>
  );
}

// -- DyadExpandIcon --

interface DyadExpandIconProps {
  isExpanded: boolean;
}

/**
 * Animated chevron icon for expand/collapse. Rotates 90 degrees when expanded.
 */
export function DyadExpandIcon({ isExpanded }: DyadExpandIconProps) {
  return (
    <ChevronRight
      size={16}
      className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
        isExpanded ? "rotate-90" : ""
      }`}
    />
  );
}

// -- DyadStateIndicator --

interface DyadStateIndicatorProps {
  state: CustomTagState;
  pendingLabel?: string;
  abortedLabel?: string;
  finishedLabel?: string;
}

/**
 * Renders a spinner (pending), X icon (aborted), or checkmark (finished).
 * Includes an optional text label for each state.
 */
export function DyadStateIndicator({
  state,
  pendingLabel,
  abortedLabel,
  finishedLabel,
}: DyadStateIndicatorProps) {
  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs shrink-0">
        <Loader2 size={14} className="animate-spin" />
        {pendingLabel && <span>{pendingLabel}</span>}
      </span>
    );
  }

  if (state === "aborted") {
    return (
      <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400 text-xs shrink-0">
        <CircleX size={14} />
        {abortedLabel && <span>{abortedLabel}</span>}
      </span>
    );
  }

  if (state === "finished") {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-500 text-xs shrink-0">
        <CheckCircle2 size={14} />
        {finishedLabel && <span>{finishedLabel}</span>}
      </span>
    );
  }

  return null;
}

// -- DyadFinishedIcon --

/**
 * Small green checkmark for completed state, useful for status-type cards.
 */
export function DyadFinishedIcon() {
  return (
    <CheckCircle2 className="size-4 text-green-600 dark:text-green-500 shrink-0" />
  );
}

// -- DyadCardContent --

interface DyadCardContentProps {
  isExpanded: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Expandable content area using CSS grid for smooth height animation.
 * Uses lazy mounting: children are only rendered after the first expansion,
 * preventing heavy components from initializing when collapsed.
 */
export function DyadCardContent({
  isExpanded,
  children,
  className = "",
}: DyadCardContentProps) {
  const [hasExpanded, setHasExpanded] = useState(false);

  useEffect(() => {
    if (isExpanded && !hasExpanded) {
      setHasExpanded(true);
    }
  }, [isExpanded]);

  return (
    <div
      className={`grid transition-all duration-200 ease-in-out ${
        isExpanded
          ? "grid-rows-[1fr] opacity-100"
          : "grid-rows-[0fr] opacity-0 pointer-events-none"
      } ${className}`}
    >
      <div className="overflow-hidden">
        <div className="px-3 pb-3">{hasExpanded ? children : null}</div>
      </div>
    </div>
  );
}

// -- DyadFilePath --

interface DyadFilePathProps {
  path: string;
}

/**
 * Styled file path display with monospace font and muted color.
 */
export function DyadFilePath({ path }: DyadFilePathProps) {
  if (!path) return null;
  return (
    <div className="px-3 pb-1">
      <span className="text-[11px] text-muted-foreground font-mono truncate block">
        {path}
      </span>
    </div>
  );
}

// -- DyadDescription --

interface DyadDescriptionProps {
  children: React.ReactNode;
}

/**
 * Description/summary text below the header.
 */
export function DyadDescription({ children }: DyadDescriptionProps) {
  return (
    <div className="px-3 pb-2 text-xs text-muted-foreground">{children}</div>
  );
}
