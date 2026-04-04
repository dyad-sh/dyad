/**
 * Dataset Studio — Shared visual constants and design maps.
 * Moved from scraping/constants.ts + extended for the unified page.
 */

import {
  Zap,
  Globe,
  Shield,
  Terminal,
  Wand2,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Pause,
  AlertCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { createElement } from "react";

// ── Engine Visual Map ───────────────────────────────────────────────────────

export interface EngineVisual {
  label: string;
  icon: ReactNode;
  gradient: string;
  iconColor: string;
  shadow: string;
  description: string;
}

export const ENGINE_VISUALS: Record<string, EngineVisual> = {
  auto: {
    label: "Auto",
    icon: createElement(Wand2, { className: "h-4 w-4" }),
    gradient: "from-amber-500/10 via-orange-500/10 to-yellow-500/10 hover:from-amber-500/20 hover:via-orange-500/20 hover:to-yellow-500/20",
    iconColor: "text-amber-500",
    shadow: "shadow-amber-500/5",
    description: "Auto-detect best engine",
  },
  static: {
    label: "Static",
    icon: createElement(Zap, { className: "h-4 w-4" }),
    gradient: "from-blue-500/10 via-cyan-500/10 to-teal-500/10 hover:from-blue-500/20 hover:via-cyan-500/20 hover:to-teal-500/20",
    iconColor: "text-blue-500",
    shadow: "shadow-blue-500/5",
    description: "Fast HTTP fetch",
  },
  browser: {
    label: "Browser",
    icon: createElement(Globe, { className: "h-4 w-4" }),
    gradient: "from-violet-500/10 via-purple-500/10 to-pink-500/10 hover:from-violet-500/20 hover:via-purple-500/20 hover:to-pink-500/20",
    iconColor: "text-violet-500",
    shadow: "shadow-violet-500/5",
    description: "Full Chromium render",
  },
  stealth: {
    label: "Stealth",
    icon: createElement(Shield, { className: "h-4 w-4" }),
    gradient: "from-rose-500/10 via-pink-500/10 to-fuchsia-500/10 hover:from-rose-500/20 hover:via-pink-500/20 hover:to-fuchsia-500/20",
    iconColor: "text-rose-500",
    shadow: "shadow-rose-500/5",
    description: "Anti-bot bypass",
  },
  api: {
    label: "API",
    icon: createElement(Terminal, { className: "h-4 w-4" }),
    gradient: "from-teal-500/10 via-cyan-500/10 to-sky-500/10 hover:from-teal-500/20 hover:via-cyan-500/20 hover:to-sky-500/20",
    iconColor: "text-teal-500",
    shadow: "shadow-teal-500/5",
    description: "Direct JSON endpoint",
  },
};

// ── Status Visual Map ───────────────────────────────────────────────────────

export interface StatusVisual {
  icon: ReactNode;
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const STATUS_VISUALS: Record<string, StatusVisual> = {
  queued: {
    icon: createElement(Clock, { className: "h-4 w-4" }),
    label: "Queued",
    color: "text-gray-500",
    bg: "bg-gray-500/10",
    border: "border-gray-500/20",
  },
  running: {
    icon: createElement(Loader2, { className: "h-4 w-4 animate-spin" }),
    label: "Running",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  done: {
    icon: createElement(CheckCircle2, { className: "h-4 w-4" }),
    label: "Completed",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  failed: {
    icon: createElement(XCircle, { className: "h-4 w-4" }),
    label: "Failed",
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
  paused: {
    icon: createElement(Pause, { className: "h-4 w-4" }),
    label: "Paused",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  cancelled: {
    icon: createElement(AlertCircle, { className: "h-4 w-4" }),
    label: "Cancelled",
    color: "text-gray-400",
    bg: "bg-gray-400/10",
    border: "border-gray-400/20",
  },
};

// ── Template Category Colors ────────────────────────────────────────────────

export const TEMPLATE_CATEGORY_COLORS: Record<string, string> = {
  news: "from-blue-500 to-indigo-500",
  ecommerce: "from-emerald-500 to-teal-500",
  social: "from-pink-500 to-rose-500",
  documentation: "from-violet-500 to-purple-500",
  data: "from-amber-500 to-yellow-500",
};

export function getCategoryGradient(category?: string): string {
  return TEMPLATE_CATEGORY_COLORS[category ?? ""] ?? "from-gray-400 to-gray-500";
}

// ── Animation Variants ──────────────────────────────────────────────────────

export const fadeUpVariant = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

export const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};
