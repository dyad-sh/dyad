import { motion, AnimatePresence } from "framer-motion";
import { FileCode2, LayoutTemplate, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const BUILD_VERBS = [
  "building",
  "sculpting",
  "crafting",
  "assembling",
  "forging",
  "weaving",
];

const SKELETON_CARDS = [
  {
    icon: FileCode2,
    titleKey: "buildingPreview.cardComponent" as const,
    pathKey: "buildingPreview.cardComponentPath" as const,
    accent: "cyan" as const,
  },
  {
    icon: Route,
    titleKey: "buildingPreview.cardRoutes" as const,
    pathKey: "buildingPreview.cardRoutesPath" as const,
    accent: "violet" as const,
  },
  {
    icon: LayoutTemplate,
    titleKey: "buildingPreview.cardLayout" as const,
    pathKey: "buildingPreview.cardLayoutPath" as const,
    accent: "sky" as const,
  },
] as const;

const ACCENT_STYLES: Record<
  string,
  { border: string; icon: string; glow: string }
> = {
  cyan: {
    border: "border-l-cyan-400",
    icon: "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30",
    glow: "shadow-[0_0_24px_-4px_rgba(0,229,255,0.35)]",
  },
  violet: {
    border: "border-l-violet-400",
    icon: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/30",
    glow: "shadow-[0_0_24px_-4px_rgba(139,92,246,0.35)]",
  },
  sky: {
    border: "border-l-sky-400",
    icon: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30",
    glow: "shadow-[0_0_24px_-4px_rgba(56,189,248,0.3)]",
  },
};

function PremiumLoader() {
  return (
    <div className="building-preview-reactor" aria-hidden>
      <div className="building-preview-reactor-ring building-preview-reactor-ring--outer" />
      <div className="building-preview-reactor-ring building-preview-reactor-ring--inner" />
      <div className="building-preview-reactor-core" />
      <div className="building-preview-reactor-pulse" />
    </div>
  );
}

function SkeletonBuildCard({
  icon: Icon,
  title,
  path,
  accent,
  delay,
  active,
}: {
  icon: typeof FileCode2;
  title: string;
  path: string;
  accent: string;
  delay: number;
  active: boolean;
}) {
  const styles = ACCENT_STYLES[accent] ?? ACCENT_STYLES.cyan;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "building-preview-glass-card relative overflow-hidden rounded-xl border border-l-[3px]",
        "border-white/[0.06] backdrop-blur-md",
        styles.border,
        active && styles.glow,
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            styles.icon,
          )}
        >
          <Icon size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium tracking-tight text-[#e8f4f8]">
            {title}
          </p>
          <p className="truncate font-mono text-[10px] text-cyan-100/45">
            {path}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            active
              ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/25"
              : "bg-white/5 text-white/40",
          )}
        >
          {active && (
            <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          <span className="font-jarvis-ui">
            {active ? "Writing" : "Queued"}
          </span>
        </span>
      </div>
      <div className="building-preview-skeleton-lines space-y-2 border-t border-white/[0.05] px-3.5 py-3">
        <div className="building-preview-skeleton-line h-2 w-full" />
        <div className="building-preview-skeleton-line h-2 w-[82%]" />
        <div className="building-preview-skeleton-line h-2 w-[58%]" />
      </div>
    </motion.div>
  );
}

export function BuildingPreviewScreen({
  variant = "panel",
  phase = "building",
}: {
  variant?: "panel" | "fullscreen";
  phase?: "building" | "starting";
}) {
  const { t } = useTranslation("home");
  const [verbIndex, setVerbIndex] = useState(0);
  const [activeCard, setActiveCard] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setVerbIndex((prev) => (prev + 1) % BUILD_VERBS.length);
    }, 3800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveCard((prev) => (prev + 1) % SKELETON_CARDS.length);
    }, 2400);
    return () => clearInterval(id);
  }, []);

  const verb = BUILD_VERBS[verbIndex];
  const title =
    phase === "starting"
      ? t("buildingPreview.startingTitle")
      : t("buildingPreview.title");
  const subtitle =
    phase === "starting"
      ? t("buildingPreview.startingSubtitle")
      : t("buildingPreview.subtitle", { verb });

  return (
    <motion.div
      data-testid="building-preview-screen"
      className={cn(
        "building-preview-canvas relative flex h-full w-full flex-col items-center justify-center overflow-hidden",
        variant === "fullscreen" ? "min-h-[420px] p-8" : "absolute inset-0",
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div className="building-preview-aurora" aria-hidden />
      <div className="building-preview-grid" aria-hidden />
      <motion.div className="building-preview-scanline" aria-hidden />
      <div className="building-preview-vignette" aria-hidden />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-9 px-6">
        <div className="flex flex-col items-center gap-5 text-center">
          <PremiumLoader />
          <div className="space-y-2.5">
            <motion.h2
              key={title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-jarvis-display text-xl font-semibold tracking-[0.12em] text-[#e8f8fa] sm:text-2xl"
            >
              {title}
            </motion.h2>
            <AnimatePresence mode="wait">
              <motion.p
                key={subtitle}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="font-jarvis-ui text-xs tracking-[0.28em] text-cyan-300/60 uppercase sm:text-sm"
              >
                {subtitle}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <div className="w-full space-y-3">
          {SKELETON_CARDS.map((card, index) => (
            <SkeletonBuildCard
              key={card.titleKey}
              icon={card.icon}
              title={t(card.titleKey)}
              path={t(card.pathKey)}
              accent={card.accent}
              delay={index * 0.1}
              active={index === activeCard}
            />
          ))}
        </div>

        <div className="w-full max-w-xs space-y-2">
          <div className="building-preview-progress-track h-1 overflow-hidden rounded-full">
            <div className="building-preview-progress-fill h-full w-[38%] rounded-full" />
          </div>
          <p className="text-center font-mono text-[10px] tracking-widest text-cyan-500/40 uppercase">
            {phase === "starting" ? "Initializing" : "Synthesizing"}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
