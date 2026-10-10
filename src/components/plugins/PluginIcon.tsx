import { useState } from "react";

// The vendor's mark for a catalog server, or the server's initial when
// there is no icon or it fails to load. Every plugin card shows the tile
// so manually added servers line up with catalog ones. The tile stays
// light in dark mode: several marks are plain black and would vanish on
// a dark card.
export function PluginIcon({
  name,
  iconUrl,
  size = "sm",
}: {
  name: string;
  iconUrl?: string;
  size?: "sm" | "md";
}) {
  // Remember which URL failed, so a new URL gets its own try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = iconUrl != null && iconUrl !== failedUrl;
  const tile = size === "md" ? "size-12 rounded-lg" : "size-9 rounded-md";
  const letter = size === "md" ? "text-lg" : "text-sm";
  return (
    <span
      aria-hidden
      className={`flex ${tile} shrink-0 items-center justify-center overflow-hidden border border-border bg-white`}
    >
      {showImage ? (
        <img
          src={iconUrl}
          alt=""
          className="size-full object-contain p-1.5"
          loading="lazy"
          draggable={false}
          onError={() => setFailedUrl(iconUrl)}
          data-testid="plugin-icon"
        />
      ) : (
        <span
          className={`${letter} font-semibold text-neutral-500`}
          data-testid="plugin-icon-fallback"
        >
          {Array.from(name)[0]?.toUpperCase()}
        </span>
      )}
    </span>
  );
}
