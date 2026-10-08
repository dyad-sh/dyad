import { useState } from "react";

// The vendor's mark for a catalog server, or the server's initial when
// there is no icon or it fails to load. Every plugin card shows the tile
// so manually added servers line up with catalog ones. The tile stays
// light in dark mode: several marks are plain black and would vanish on
// a dark card.
//
// Key the element on the URL so a failed load is forgotten when it
// changes.
export function PluginIcon({
  name,
  iconUrl,
  size = "sm",
}: {
  name: string;
  iconUrl?: string;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const showImage = iconUrl != null && !failed;
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
          onError={() => setFailed(true)}
          data-testid="plugin-icon"
        />
      ) : (
        <span
          className={`${letter} font-semibold text-neutral-500`}
          data-testid="plugin-icon-fallback"
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
