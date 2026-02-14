/**
 * Deterministic avatar generation for apps
 *
 * Generates GitHub-style geometric avatars from a seed string.
 * Uses a 16-color palette and 8 geometric patterns with shape variance
 * to ensure colorblind-safe distinction between avatars.
 */

/**
 * Avatar configuration stored in iconData when iconType is "generated"
 */
export interface GeneratedAvatarConfig {
  seed: string;
  version: 1;
}

/**
 * 16-color palette designed for:
 * - Good contrast on both light and dark backgrounds
 * - Colorblind-friendly with sufficient variation
 * - Visually pleasing and modern
 */
const AVATAR_COLORS = [
  "#E57373", // Red 300
  "#F06292", // Pink 300
  "#BA68C8", // Purple 300
  "#9575CD", // Deep Purple 300
  "#7986CB", // Indigo 300
  "#64B5F6", // Blue 300
  "#4FC3F7", // Light Blue 300
  "#4DD0E1", // Cyan 300
  "#4DB6AC", // Teal 300
  "#81C784", // Green 300
  "#AED581", // Light Green 300
  "#DCE775", // Lime 300
  "#FFD54F", // Amber 300
  "#FFB74D", // Orange 300
  "#FF8A65", // Deep Orange 300
  "#A1887F", // Brown 300
] as const;

/**
 * Background colors that pair well with the foreground colors
 * Slightly darker/muted versions for better contrast
 */
const BACKGROUND_COLORS = [
  "#FFEBEE", // Red 50
  "#FCE4EC", // Pink 50
  "#F3E5F5", // Purple 50
  "#EDE7F6", // Deep Purple 50
  "#E8EAF6", // Indigo 50
  "#E3F2FD", // Blue 50
  "#E1F5FE", // Light Blue 50
  "#E0F7FA", // Cyan 50
  "#E0F2F1", // Teal 50
  "#E8F5E9", // Green 50
  "#F1F8E9", // Light Green 50
  "#F9FBE7", // Lime 50
  "#FFF8E1", // Amber 50
  "#FFF3E0", // Orange 50
  "#FBE9E7", // Deep Orange 50
  "#EFEBE9", // Brown 50
] as const;

/**
 * Dark mode background colors
 */
const DARK_BACKGROUND_COLORS = [
  "#1a1a2e", // Dark blue-black
  "#1e1e30", // Dark indigo
  "#1f1f33", // Dark purple
  "#1a1f2e", // Dark slate
  "#1e2a35", // Dark teal-blue
  "#1a2f2f", // Dark teal
  "#1f2d1f", // Dark green
  "#2d2a1f", // Dark amber
  "#2d1f1f", // Dark red
  "#2a1f2a", // Dark magenta
  "#1f2a2a", // Dark cyan
  "#2a2a1f", // Dark olive
  "#2f2a25", // Dark brown
  "#252525", // Dark gray
  "#1f1f1f", // Near black
  "#2a2a2a", // Charcoal
] as const;

/**
 * 8 geometric patterns that vary by shape, not just color
 * Each pattern is represented as a 5x5 grid where 1 = filled, 0 = empty
 * The grid is symmetric to create pleasing patterns
 */
const PATTERNS = [
  // Pattern 0: Diamond
  [
    [0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0],
  ],
  // Pattern 1: Plus
  [
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  // Pattern 2: Square frame
  [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ],
  // Pattern 3: Diagonal stripes
  [
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
  ],
  // Pattern 4: Corners
  [
    [1, 1, 0, 1, 1],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 1, 0, 1, 1],
  ],
  // Pattern 5: Center dot with corners
  [
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [1, 0, 0, 0, 1],
  ],
  // Pattern 6: Horizontal bars
  [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  // Pattern 7: T-shape
  [
    [1, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
] as const;

/**
 * Simple hash function to generate a number from a string
 * Uses DJB2 algorithm for good distribution
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Generate a seed string for an avatar from app ID and name
 */
export function generateAvatarSeed(appId: number, appName: string): string {
  return `${appId}-${appName}-${Date.now()}`;
}

/**
 * Generate a deterministic avatar configuration from a seed
 */
export function generateAvatarConfig(seed: string): GeneratedAvatarConfig {
  return {
    seed,
    version: 1,
  };
}

/**
 * Parse icon data to get avatar config
 */
export function parseAvatarConfig(
  iconData: string | null,
): GeneratedAvatarConfig | null {
  if (!iconData) return null;
  try {
    const config = JSON.parse(iconData);
    if (config.version === 1 && typeof config.seed === "string") {
      return config as GeneratedAvatarConfig;
    }
  } catch {
    // Invalid JSON, return null
  }
  return null;
}

/**
 * Get avatar colors and pattern from a seed
 */
export function getAvatarProperties(seed: string): {
  foregroundColor: string;
  backgroundColor: string;
  darkBackgroundColor: string;
  pattern: (0 | 1)[][];
  patternIndex: number;
  colorIndex: number;
} {
  const hash = hashString(seed);

  // Use different bits of the hash for different properties
  const colorIndex = hash % AVATAR_COLORS.length;
  const patternIndex = (hash >> 4) % PATTERNS.length;
  // Use a different color index for background to ensure contrast
  const bgOffset = ((hash >> 8) % 8) + 4; // Offset by 4-11 positions
  const bgColorIndex = (colorIndex + bgOffset) % BACKGROUND_COLORS.length;

  return {
    foregroundColor: AVATAR_COLORS[colorIndex],
    backgroundColor: BACKGROUND_COLORS[bgColorIndex],
    darkBackgroundColor: DARK_BACKGROUND_COLORS[bgColorIndex],
    pattern: PATTERNS[patternIndex] as unknown as (0 | 1)[][],
    patternIndex,
    colorIndex,
  };
}

/**
 * Generate SVG markup for an avatar
 */
export function generateAvatarSvg(
  seed: string,
  size: number = 40,
  darkMode: boolean = false,
): string {
  const { foregroundColor, backgroundColor, darkBackgroundColor, pattern } =
    getAvatarProperties(seed);

  const cellSize = size / 5;
  const bgColor = darkMode ? darkBackgroundColor : backgroundColor;

  let cells = "";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (pattern[row][col] === 1) {
        cells += `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="${foregroundColor}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${bgColor}" rx="${size * 0.15}"/>
    ${cells}
  </svg>`;
}

/**
 * Get the first letter of an app name for fallback display
 */
export function getAppInitial(appName: string): string {
  const trimmed = appName.trim();
  if (!trimmed) return "?";
  // Get first character, handling emojis properly
  const chars = [...trimmed];
  return chars[0].toUpperCase();
}

/**
 * Get a deterministic color for a fallback initial based on app ID
 */
export function getFallbackColor(appId: number): string {
  return AVATAR_COLORS[appId % AVATAR_COLORS.length];
}

/**
 * Get a deterministic background color for a fallback initial
 */
export function getFallbackBackgroundColor(
  appId: number,
  darkMode: boolean = false,
): string {
  const colors = darkMode ? DARK_BACKGROUND_COLORS : BACKGROUND_COLORS;
  return colors[appId % colors.length];
}
