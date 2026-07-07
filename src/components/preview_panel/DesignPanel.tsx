import React, { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Palette, RefreshCw, ImageIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  designStateAtom,
  regeneratingInterfacesAtom,
} from "@/atoms/designAtoms";
import { useDesign } from "@/hooks/useDesign";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useLoadApp } from "@/hooks/useLoadApp";
import { buildDyadMediaUrlFromRelativePath } from "@/lib/dyadMediaUrl";
import { ImageLightbox } from "@/components/chat/ImageLightbox";
import type { DesignInterface, DesignSystem } from "@/ipc/types/design";
import { cn } from "@/lib/utils";

export const DesignPanel: React.FC = () => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const designState = useAtomValue(designStateAtom);
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const regeneratingByChat = useAtomValue(regeneratingInterfacesAtom);
  const { app } = useLoadApp(appId);
  const appPath = app?.resolvedPath ?? app?.path ?? "";

  // Load a persisted spec from disk if it isn't already in memory.
  useDesign();

  const spec = chatId ? designState.specsByChatId.get(chatId) : null;
  const regenerating = useMemo(
    () =>
      chatId
        ? (regeneratingByChat.get(chatId) ?? new Set<string>())
        : new Set<string>(),
    [chatId, regeneratingByChat],
  );

  // If there's no design spec, fall back to the app preview.
  useEffect(() => {
    if (!spec && previewMode === "design") {
      setPreviewMode("preview");
    }
  }, [spec, previewMode, setPreviewMode]);

  if (!spec) {
    return null;
  }

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="design-panel">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-start gap-2">
          <Palette className="mt-0.5 text-pink-500" size={20} />
          <div>
            <h2 className="text-lg font-semibold">{spec.title}</h2>
            {spec.summary && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {spec.summary}
              </p>
            )}
          </div>
        </header>

        <DesignSystemSection designSystem={spec.designSystem} />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Interfaces ({spec.interfaces.length})
          </h3>
          <div className="grid grid-cols-1 gap-4">
            {spec.interfaces.map((iface) => (
              <InterfaceCard
                key={iface.id}
                iface={iface}
                appPath={appPath}
                isRegenerating={regenerating.has(iface.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

function DesignSystemSection({ designSystem }: { designSystem: DesignSystem }) {
  return (
    <section className="border rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Design system</h3>
        <span className="text-xs text-muted-foreground">
          {designSystem.mood}
        </span>
      </div>

      {designSystem.colors.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {designSystem.colors.map((color, i) => (
            <div key={`${color.name}-${i}`} className="flex items-center gap-2">
              <span
                className="h-8 w-8 rounded-md border shadow-sm shrink-0"
                style={{ backgroundColor: color.hex }}
                title={`${color.name} ${color.hex}`}
              />
              <div className="text-xs leading-tight">
                <div className="font-medium">{color.name}</div>
                <div className="text-muted-foreground font-mono">
                  {color.hex}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Headings
          </div>
          <div>{designSystem.typography.heading}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">Body</div>
          <div>{designSystem.typography.body}</div>
        </div>
        {designSystem.typography.notes && (
          <div className="sm:col-span-2 text-muted-foreground">
            {designSystem.typography.notes}
          </div>
        )}
        {designSystem.spacing && (
          <div className="sm:col-span-2">
            <div className="text-xs font-medium text-muted-foreground">
              Spacing &amp; layout
            </div>
            <div>{designSystem.spacing}</div>
          </div>
        )}
        {designSystem.notes && (
          <div className="sm:col-span-2 text-muted-foreground">
            {designSystem.notes}
          </div>
        )}
      </div>
    </section>
  );
}

function InterfaceCard({
  iface,
  appPath,
  isRegenerating,
}: {
  iface: DesignInterface;
  appPath: string;
  isRegenerating: boolean;
}) {
  const chatId = useAtomValue(selectedChatIdAtom);
  const setRegeneratingByChat = useSetAtom(regeneratingInterfacesAtom);
  const { streamMessage, isStreaming } = useStreamChat();
  const [showDetails, setShowDetails] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imageUrl = iface.imagePath
    ? buildDyadMediaUrlFromRelativePath(appPath, iface.imagePath)
    : "";
  const absolutePath =
    appPath && iface.imagePath ? `${appPath}/${iface.imagePath}` : undefined;
  const canView = !!imageUrl && !imageError;

  const handleRegenerate = () => {
    if (!chatId || isStreaming) return;
    setRegeneratingByChat((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(chatId) ?? []);
      set.add(iface.id);
      next.set(chatId, set);
      return next;
    });
    streamMessage({
      chatId,
      requestedChatMode: "design",
      prompt: `Please regenerate the image for the "${iface.name}" interface, keeping it consistent with the design system. Call generate_image again for this screen, then update the design spec (write_design_spec) with the new imagePath.`,
    });
  };

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <button
          type="button"
          onClick={() => canView && setIsLightboxOpen(true)}
          className={cn(
            "relative bg-muted flex items-center justify-center shrink-0 sm:w-56 h-40 sm:h-auto",
            canView ? "cursor-zoom-in" : "cursor-default",
          )}
          aria-label={canView ? `View ${iface.name}` : iface.name}
        >
          {canView ? (
            <img
              src={imageUrl}
              alt={iface.name}
              className="h-full w-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
              {isRegenerating ? (
                <>
                  <RefreshCw size={20} className="animate-spin" />
                  <span>Generating…</span>
                </>
              ) : (
                <>
                  <ImageIcon size={20} />
                  <span>No image yet</span>
                </>
              )}
            </div>
          )}
          {isRegenerating && canView && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <RefreshCw size={20} className="animate-spin" />
            </div>
          )}
        </button>

        <div className="flex-1 min-w-0 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-medium truncate">{iface.name}</h4>
              <p className="text-xs text-muted-foreground">{iface.purpose}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRegenerate}
              disabled={isStreaming || isRegenerating}
              data-testid={`regenerate-interface-${iface.id}`}
            >
              <RefreshCw size={14} className="mr-1.5" />
              Regenerate
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              size={14}
              className={cn(
                "transition-transform",
                showDetails && "rotate-180",
              )}
            />
            {showDetails ? "Hide" : "Show"} prompt &amp; copy
          </button>

          {showDetails && (
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  Prompt
                </div>
                <p className="text-foreground whitespace-pre-wrap">
                  {iface.prompt}
                </p>
              </div>
              {iface.copy && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Copy
                  </div>
                  <p className="text-foreground whitespace-pre-wrap">
                    {iface.copy}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isLightboxOpen && imageUrl && (
        <ImageLightbox
          imageUrl={imageUrl}
          alt={iface.name}
          filePath={absolutePath}
          onClose={() => setIsLightboxOpen(false)}
          onError={() => {
            setImageError(true);
            setIsLightboxOpen(false);
          }}
        />
      )}
    </div>
  );
}
