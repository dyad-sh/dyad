import { useEffect, useState } from "react";
import type { ListedApp } from "@/ipc/types/app";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface AppShowcaseCardProps {
  app: ListedApp;
  thumbnailUrl: string | null;
  onClick: (appId: number) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (appId: number) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const codePoint = trimmed.codePointAt(0);
  return codePoint
    ? String.fromCodePoint(codePoint).toUpperCase()
    : trimmed[0].toUpperCase();
}

function getPreviewHue(name: string): number {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return 175 + (hash % 105);
}

function ProjectThumbnailFallback({ name }: { name: string }) {
  const hue = getPreviewHue(name);
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-testid="app-thumbnail-fallback"
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 58% 16%), hsl(${(hue + 42) % 360} 62% 8%))`,
      }}
    >
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="absolute inset-x-[9%] top-[10%] bottom-[18%] overflow-hidden rounded-lg border border-white/15 bg-slate-950/75 shadow-2xl">
        <div className="flex h-[16%] items-center gap-1.5 border-b border-white/10 bg-white/5 px-2.5">
          <span className="size-1.5 rounded-full bg-rose-400/80" />
          <span className="size-1.5 rounded-full bg-amber-300/80" />
          <span className="size-1.5 rounded-full bg-emerald-400/80" />
          <span className="ml-2 h-1.5 w-1/3 rounded-full bg-white/10" />
        </div>
        <div className="flex h-[84%]">
          <div className="w-[22%] border-r border-white/8 bg-black/15 p-2">
            <div className="mb-2 flex size-6 items-center justify-center rounded-md border border-white/15 bg-white/8 text-[9px] font-bold text-white/80">
              {getInitial(name)}
            </div>
            <div className="space-y-1.5">
              <div className="h-1.5 rounded-full bg-white/14" />
              <div className="h-1.5 w-3/4 rounded-full bg-white/8" />
              <div className="h-1.5 w-4/5 rounded-full bg-white/8" />
            </div>
          </div>
          <div className="flex-1 p-[7%]">
            <div className="h-2.5 w-2/3 rounded-full bg-white/65" />
            <div className="mt-2 h-1.5 w-5/6 rounded-full bg-white/16" />
            <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-white/10" />
            <div className="mt-[10%] grid grid-cols-3 gap-2">
              <div className="aspect-square rounded-md border border-white/10 bg-white/8" />
              <div className="aspect-square rounded-md border border-white/10 bg-white/5" />
              <div className="aspect-square rounded-md border border-white/10 bg-white/8" />
            </div>
          </div>
        </div>
      </div>
      <div
        className="absolute -right-[12%] -top-[20%] size-36 rounded-full blur-3xl"
        style={{ backgroundColor: `hsl(${hue} 90% 55% / .28)` }}
      />
    </div>
  );
}

export function AppShowcaseCard({
  app,
  thumbnailUrl,
  onClick,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}: AppShowcaseCardProps) {
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => {
    setImageBroken(false);
  }, [thumbnailUrl]);
  const showImage = thumbnailUrl && !imageBroken;

  const handleClick = () => {
    if (isSelectionMode) {
      onToggleSelect?.(app.id);
    } else {
      onClick(app.id);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={app.name}
      data-testid={`app-showcase-card-${app.name}`}
      data-selected={isSelectionMode ? isSelected : undefined}
      role={isSelectionMode ? "checkbox" : undefined}
      aria-checked={isSelectionMode ? isSelected : undefined}
      className={cn(
        "group relative w-full aspect-[4/3] rounded-xl overflow-hidden border bg-muted hover:shadow-md transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        isSelectionMode && isSelected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/40",
      )}
    >
      {showImage ? (
        <img
          src={thumbnailUrl!}
          alt=""
          loading="lazy"
          onError={() => setImageBroken(true)}
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      ) : (
        <ProjectThumbnailFallback name={app.name} />
      )}
      {isSelectionMode && (
        <div className="absolute top-2 left-2 flex items-center justify-center rounded bg-background/90 p-1 shadow-sm pointer-events-none">
          <Checkbox
            checked={isSelected}
            tabIndex={-1}
            aria-hidden="true"
            data-testid={`app-showcase-card-${app.name}-checkbox`}
          />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2.5 px-3">
        <p className="text-sm font-semibold text-white truncate text-left">
          {app.name}
        </p>
      </div>
    </button>
  );
}
