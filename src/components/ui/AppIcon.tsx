import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  deriveAvatarStyle,
  getFallbackColor,
  getFallbackLetter,
  parseGeneratedIconData,
} from "@/lib/appIcons";

function renderPattern(pattern: number, color: string): ReactNode {
  switch (pattern) {
    case 0:
      return <circle cx="12" cy="12" r="5" fill={color} fillOpacity="0.8" />;
    case 1:
      return <rect x="6" y="6" width="12" height="12" fill={color} rx="2" />;
    case 2:
      return <polygon points="12,4 20,20 4,20" fill={color} />;
    case 3:
      return (
        <g stroke={color} strokeWidth="2">
          <line x1="4" y1="4" x2="20" y2="20" />
          <line x1="20" y1="4" x2="4" y2="20" />
        </g>
      );
    case 4:
      return (
        <>
          <rect x="4" y="4" width="6" height="6" fill={color} />
          <rect x="14" y="4" width="6" height="6" fill={color} />
          <rect x="4" y="14" width="6" height="6" fill={color} />
          <rect x="14" y="14" width="6" height="6" fill={color} />
        </>
      );
    case 5:
      return (
        <>
          <circle cx="7" cy="7" r="3" fill={color} />
          <circle cx="17" cy="7" r="3" fill={color} />
          <circle cx="7" cy="17" r="3" fill={color} />
          <circle cx="17" cy="17" r="3" fill={color} />
        </>
      );
    case 6:
      return (
        <g fill={color}>
          <path d="M12 4 L20 12 L12 20 L4 12 Z" />
          <circle cx="12" cy="12" r="2.5" />
        </g>
      );
    default:
      return (
        <g fill={color} fillOpacity="0.85">
          <path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4z" />
        </g>
      );
  }
}

type AppIconProps = {
  appId: number;
  appName: string;
  iconType: string | null;
  iconData: string | null;
  size?: number;
  className?: string;
  title?: string;
};

export function AppIcon({
  appId,
  appName,
  iconType,
  iconData,
  size = 20,
  className,
  title,
}: AppIconProps) {
  if (iconType === "emoji" && iconData?.trim()) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md select-none",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(12, size - 2) }}
        role="img"
        aria-label={appName}
        title={title}
      >
        <span aria-hidden="true">{iconData}</span>
        <span className="sr-only">{appName}</span>
      </span>
    );
  }

  const generated = parseGeneratedIconData(iconType, iconData);
  if (generated) {
    const style = deriveAvatarStyle(generated.seed);
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center",
          className,
        )}
        style={{ width: size, height: size }}
        role="img"
        aria-label={appName}
        title={title}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className="rounded-md"
          aria-hidden="true"
        >
          <rect width="24" height="24" fill={style.background} rx="5" />
          {renderPattern(style.pattern, style.foreground)}
          {renderPattern(style.accentPattern, style.foreground)}
        </svg>
        <span className="sr-only">{appName}</span>
      </span>
    );
  }

  const letter = getFallbackLetter(appName);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: getFallbackColor(appId),
        fontSize: Math.max(10, Math.floor(size * 0.45)),
      }}
      role="img"
      aria-label={appName}
      title={title}
    >
      <span aria-hidden="true">{letter}</span>
      <span className="sr-only">{appName}</span>
    </span>
  );
}
