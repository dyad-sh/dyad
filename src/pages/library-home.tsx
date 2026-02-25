import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePrompts } from "@/hooks/usePrompts";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useAppMediaFiles } from "@/hooks/useAppMediaFiles";
import { BookOpen } from "lucide-react";
import { CreateOrEditPromptDialog } from "@/components/CreatePromptDialog";
import { CustomThemeDialog } from "@/components/CustomThemeDialog";
import { NewLibraryItemMenu } from "@/components/NewLibraryItemMenu";
import { showInfo } from "@/lib/toast";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddPromptDeepLinkData } from "@/ipc/deep_link_data";
import { LibraryCard, type LibraryItem } from "@/components/LibraryCard";
import { LibrarySearchBar } from "@/components/LibrarySearchBar";
import {
  LibraryFilterTabs,
  type FilterType,
} from "@/components/LibraryFilterTabs";
import { DyadAppMediaFolder } from "@/components/DyadAppMediaFolder";
// @ts-expect-error -- SVG asset import handled by bundler
import logo from "../../assets/logo.svg";

// Once-per-session animation flag
let hasAnimatedThisSession = false;

// ---------------------------------------------------------------------------
// Landing Animation
// ---------------------------------------------------------------------------

const SPRING_EASE = [0.22, 1.2, 0.36, 1] as const;

function LibraryLandingAnimation({ onComplete }: { onComplete: () => void }) {
  const orbs = [0, 1, 2, 3, 4];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {/* Orbiting dots around the logo */}
      <div className="relative">
        {orbs.map((i) => (
          <motion.div
            key={i}
            className="absolute h-2 w-2 rounded-full bg-primary"
            style={{
              boxShadow:
                "0 0 8px color-mix(in srgb, var(--primary) 40%, transparent)",
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{
              opacity: [0, 0.8, 0],
              scale: [0.5, 1.2, 0.5],
              x: [0, Math.cos((i * 2 * Math.PI) / 5) * 50, 0],
              y: [0, Math.sin((i * 2 * Math.PI) / 5) * 50, 0],
            }}
            transition={{
              duration: 1.2,
              ease: SPRING_EASE,
              delay: 0.1 + i * 0.06,
            }}
          />
        ))}

        {/* Logo with scale-in and glow */}
        <motion.div
          className="relative"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: SPRING_EASE }}
        >
          {/* Glow halo */}
          <motion.div
            className="absolute -inset-6 rounded-full blur-xl"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--primary) 25%, transparent), transparent 70%)",
            }}
            animate={{
              scale: [1, 1.4, 1],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: 1.5,
              ease: "easeInOut",
            }}
          />
          <img src={logo} alt="Dyad" className="relative w-16 h-16" />
        </motion.div>
      </div>

      {/* "Library" text */}
      <motion.h1
        className="text-2xl font-bold mt-6 text-foreground tracking-tight"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.45, ease: "easeOut" }}
        onAnimationComplete={() => {
          setTimeout(onComplete, 550);
        }}
      >
        Library
      </motion.h1>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Library Homepage
// ---------------------------------------------------------------------------

export default function LibraryHomePage() {
  const [showAnimation, setShowAnimation] = useState(() => {
    if (hasAnimatedThisSession) return false;
    hasAnimatedThisSession = true;
    return true;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>(() => {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("filter");
    if (filter === "themes" || filter === "prompts" || filter === "media")
      return filter;
    return "all";
  });

  const {
    prompts,
    isLoading: promptsLoading,
    createPrompt,
    updatePrompt,
    deletePrompt,
  } = usePrompts();
  const { customThemes, isLoading: themesLoading } = useCustomThemes();
  const { mediaApps, isLoading: mediaLoading } = useAppMediaFiles();
  const [createThemeDialogOpen, setCreateThemeDialogOpen] = useState(false);

  // Deep link support (preserved from old library.tsx)
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [prefillData, setPrefillData] = useState<
    { title: string; description: string; content: string } | undefined
  >(undefined);

  useEffect(() => {
    if (lastDeepLink?.type === "add-prompt") {
      const deepLink = lastDeepLink as unknown as AddPromptDeepLinkData;
      const payload = deepLink.payload;
      showInfo(`Prefilled prompt: ${payload.title}`);
      setPrefillData({
        title: payload.title,
        description: payload.description,
        content: payload.content,
      });
      setActiveFilter("prompts");
      setPromptDialogOpen(true);
      clearLastDeepLink();
    }
  }, [lastDeepLink?.timestamp, clearLastDeepLink]);

  const handlePromptDialogClose = (open: boolean) => {
    setPromptDialogOpen(open);
    if (!open) {
      setPrefillData(undefined);
    }
  };

  const isLoading = promptsLoading || themesLoading || mediaLoading;

  const filteredItems = useMemo(() => {
    if (activeFilter === "media") return [];

    let items: LibraryItem[] = [];

    if (activeFilter === "all" || activeFilter === "themes") {
      items.push(
        ...customThemes.map((t) => ({ type: "theme" as const, data: t })),
      );
    }
    if (activeFilter === "all" || activeFilter === "prompts") {
      items.push(...prompts.map((p) => ({ type: "prompt" as const, data: p })));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) => {
        if (item.type === "theme") {
          return (
            item.data.name.toLowerCase().includes(q) ||
            (item.data.description?.toLowerCase().includes(q) ?? false) ||
            item.data.prompt.toLowerCase().includes(q)
          );
        }
        return (
          item.data.title.toLowerCase().includes(q) ||
          (item.data.description?.toLowerCase().includes(q) ?? false) ||
          item.data.content.toLowerCase().includes(q)
        );
      });
    }

    // Sort by updatedAt descending
    items.sort((a, b) => {
      const dateA =
        a.data.updatedAt instanceof Date
          ? a.data.updatedAt
          : new Date(a.data.updatedAt);
      const dateB =
        b.data.updatedAt instanceof Date
          ? b.data.updatedAt
          : new Date(b.data.updatedAt);
      return dateB.getTime() - dateA.getTime();
    });

    return items;
  }, [customThemes, prompts, activeFilter, searchQuery]);

  const filteredMediaApps = useMemo(() => {
    if (activeFilter === "themes" || activeFilter === "prompts") return [];

    let apps = mediaApps;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      apps = apps.filter(
        (app) =>
          app.appName.toLowerCase().includes(q) ||
          app.files.some((f) => f.fileName.toLowerCase().includes(q)),
      );
    }
    return apps;
  }, [mediaApps, activeFilter, searchQuery]);

  const hasNoResults =
    filteredItems.length === 0 && filteredMediaApps.length === 0;

  return (
    <div className="min-h-screen w-full">
      <AnimatePresence mode="wait">
        {showAnimation && (
          <LibraryLandingAnimation
            key="landing-animation"
            onComplete={() => setShowAnimation(false)}
          />
        )}
      </AnimatePresence>

      {!showAnimation && (
        <motion.div
          className="px-8 py-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-3xl font-bold">
                <BookOpen className="inline-block h-8 w-8 mr-2" />
                Library
              </h1>
              <NewLibraryItemMenu
                onNewPrompt={() => setPromptDialogOpen(true)}
                onNewTheme={() => setCreateThemeDialogOpen(true)}
              />
            </div>

            {/* Dialogs (controlled externally) */}
            <CreateOrEditPromptDialog
              mode="create"
              onCreatePrompt={createPrompt}
              prefillData={prefillData}
              isOpen={promptDialogOpen}
              onOpenChange={handlePromptDialogClose}
              trigger={<span />}
            />

            {/* Search Bar */}
            <LibrarySearchBar value={searchQuery} onChange={setSearchQuery} />

            {/* Filter Tabs */}
            <LibraryFilterTabs
              active={activeFilter}
              onChange={setActiveFilter}
            />

            {/* Grid */}
            {isLoading ? (
              <div>Loading...</div>
            ) : hasNoResults ? (
              <div className="text-muted-foreground text-center py-12">
                {searchQuery
                  ? "No results found."
                  : "No items in your library yet."}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                {filteredItems.map((item) => (
                  <LibraryCard
                    key={`${item.type}-${item.data.id}`}
                    item={item}
                    onUpdatePrompt={updatePrompt}
                    onDeletePrompt={deletePrompt}
                  />
                ))}
                {filteredMediaApps.map((app) => (
                  <DyadAppMediaFolder
                    key={`media-${app.appId}`}
                    appId={app.appId}
                    appName={app.appName}
                    files={app.files}
                    searchQuery={searchQuery}
                  />
                ))}
              </div>
            )}
          </div>

          <CustomThemeDialog
            open={createThemeDialogOpen}
            onOpenChange={setCreateThemeDialogOpen}
          />
        </motion.div>
      )}
    </div>
  );
}
