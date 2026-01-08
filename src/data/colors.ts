export interface AppColor {
  id: string;
  name: string;
  hex: string;
}

/**
 * Primary colors for app generation.
 * The AI will use the selected color as the primary/brand color
 * and derive the rest of the palette based on the active theme.
 */
export const APP_COLORS: AppColor[] = [
  { id: "blue", name: "Blue", hex: "#2563EB" },
  { id: "green", name: "Green", hex: "#16A34A" },
  { id: "purple", name: "Purple", hex: "#7C3AED" },
  { id: "rose", name: "Rose", hex: "#E11D48" },
  { id: "orange", name: "Orange", hex: "#EA580C" },
  { id: "teal", name: "Teal", hex: "#0D9488" },
  { id: "amber", name: "Amber", hex: "#D97706" },
  { id: "indigo", name: "Indigo", hex: "#4F46E5" },
  { id: "slate", name: "Slate", hex: "#475569" },
  { id: "pink", name: "Pink", hex: "#EC4899" },
];
