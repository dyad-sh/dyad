import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  parseAvatarConfig,
  getAvatarProperties,
  getAppInitial,
  getFallbackColor,
  getFallbackBackgroundColor,
} from "@/lib/avatarGenerator";
import type { IconType } from "@/ipc/types/app";
import { useTheme } from "@/contexts/ThemeContext";

export interface AppIconProps {
  /** App ID for fallback color generation */
  appId: number;
  /** App name for fallback initial and screen reader label */
  appName: string;
  /** Icon type: "emoji" or "generated" */
  iconType: IconType | null;
  /** Icon data: emoji character or JSON config for generated avatars */
  iconData: string | null;
  /** Size in pixels (default: 20) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Show edit overlay on hover */
  showEditOverlay?: boolean;
  /** Click handler for icon editing */
  onClick?: () => void;
}

/**
 * Shared app icon component that renders:
 * - Emoji if iconType is "emoji"
 * - Generated geometric avatar if iconType is "generated"
 * - First-letter fallback if iconType is null or data is invalid
 */
export function AppIcon({
  appId,
  appName,
  iconType,
  iconData,
  size = 20,
  className,
  showEditOverlay = false,
  onClick,
}: AppIconProps) {
  const { isDarkMode } = useTheme();

  const iconContent = useMemo(() => {
    // Handle emoji type
    if (iconType === "emoji" && iconData) {
      return (
        <span
          className="flex items-center justify-center leading-none"
          style={{ fontSize: size * 0.75 }}
          aria-hidden="true"
        >
          {iconData}
        </span>
      );
    }

    // Handle generated avatar type
    if (iconType === "generated" && iconData) {
      const config = parseAvatarConfig(iconData);
      if (config) {
        const {
          foregroundColor,
          backgroundColor,
          darkBackgroundColor,
          pattern,
        } = getAvatarProperties(config.seed);
        const bgColor = isDarkMode ? darkBackgroundColor : backgroundColor;
        const cellSize = size / 5;
        const borderRadius = size * 0.15;

        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${size} ${size}`}
            width={size}
            height={size}
            aria-hidden="true"
            className="flex-shrink-0"
          >
            <rect width={size} height={size} fill={bgColor} rx={borderRadius} />
            {pattern.map((row, rowIndex) =>
              row.map((cell, colIndex) =>
                cell === 1 ? (
                  <rect
                    key={`${rowIndex}-${colIndex}`}
                    x={colIndex * cellSize}
                    y={rowIndex * cellSize}
                    width={cellSize}
                    height={cellSize}
                    fill={foregroundColor}
                  />
                ) : null,
              ),
            )}
          </svg>
        );
      }
    }

    // Fallback: first letter in a colored circle
    const initial = getAppInitial(appName);
    const bgColor = getFallbackBackgroundColor(appId, isDarkMode);
    const textColor = getFallbackColor(appId);

    return (
      <div
        className="flex items-center justify-center rounded-md font-semibold"
        style={{
          width: size,
          height: size,
          backgroundColor: bgColor,
          color: textColor,
          fontSize: size * 0.5,
        }}
        aria-hidden="true"
      >
        {initial}
      </div>
    );
  }, [appId, appName, iconType, iconData, size, isDarkMode]);

  const containerClasses = cn(
    "relative inline-flex items-center justify-center flex-shrink-0 overflow-hidden rounded-md transition-opacity",
    showEditOverlay && "cursor-pointer group",
    className,
  );

  const content = (
    <>
      {iconContent}
      {/* Screen reader text */}
      <span className="sr-only">{appName}</span>
      {/* Edit overlay */}
      {showEditOverlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size * 0.4}
            height={size * 0.4}
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={containerClasses}
        style={{ width: size, height: size }}
        aria-label={`Change icon for ${appName}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={containerClasses} style={{ width: size, height: size }}>
      {content}
    </div>
  );
}
