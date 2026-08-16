/**
 * The four selectable UI themes. Each is a set of token overrides on the same
 * components — never a second implementation of anything.
 */

export type UiTheme = "holographic" | "macos" | "dark" | "light";
/** What the user can pick: a concrete theme, or following the OS. */
export type ThemeChoice = UiTheme | "system";

export type UiThemeMeta = {
  id: UiTheme;
  label: string;
  description: string;
  /** Colours for the miniature preview card in Settings. */
  preview: {
    background: string;
    sidebar: string;
    surface: string;
    titlebar: string;
    text: string;
    mutedText: string;
    accent: string;
    userBubble: string;
  };
};

export const UI_THEMES: UiThemeMeta[] = [
  {
    id: "holographic",
    label: "Meta Human Holographic",
    description: "The flagship look — navy glass, cyan glow, living particles.",
    preview: {
      background: "#02040a",
      sidebar: "#0a1628",
      surface: "rgba(10, 26, 42, 0.9)",
      titlebar: "#0a1a2e",
      text: "#d9f6ff",
      mutedText: "#5d8ba3",
      accent: "#00e5ff",
      userBubble: "rgba(0, 229, 255, 0.18)",
    },
  },
  {
    id: "macos",
    label: "macOS Native",
    description: "Apple typography, luminous materials, native window calm.",
    preview: {
      background: "#ececee",
      sidebar: "#f0f0f2",
      surface: "#ffffff",
      titlebar: "#f6f6f8",
      text: "#1d1d1f",
      mutedText: "#6e6e73",
      accent: "#007aff",
      userBubble: "#e9e9eb",
    },
  },
  {
    id: "dark",
    label: "Dark",
    description: "Minimal charcoal for long sessions — no glow, no noise.",
    preview: {
      background: "#0d0f12",
      sidebar: "#101317",
      surface: "#14171b",
      titlebar: "#14171b",
      text: "#f3f4f6",
      mutedText: "#a7adb7",
      accent: "#22d3ee",
      userBubble: "#1b1f24",
    },
  },
  {
    id: "light",
    label: "Light",
    description: "Soft off-white clarity for daytime work.",
    preview: {
      background: "#f4f5f7",
      sidebar: "#eef0f4",
      surface: "#ffffff",
      titlebar: "#fafbfc",
      text: "#17191d",
      mutedText: "#555d68",
      accent: "#0891b2",
      userBubble: "#eceff3",
    },
  },
];

/**
 * The base palette class and token attribute a choice resolves to.
 *
 * "system" deliberately maps to the purpose-built Dark and Light themes, never
 * to Holographic or macOS — following the OS should not surprise anyone with
 * a branded look they did not pick.
 */
export function resolveThemeChoice(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): { base: "light" | "dark"; uiTheme: UiTheme } {
  const theme: UiTheme =
    choice === "system" ? (systemPrefersDark ? "dark" : "light") : choice;
  const base = theme === "holographic" || theme === "dark" ? "dark" : "light";
  return { base, uiTheme: theme };
}

/**
 * Upgrades a value stored by the old light/dark/system selector.
 *
 * Old "dark" *was* the holographic look, and old "system" showed it on every
 * dark-mode Mac — both continue to look the same after the upgrade.
 */
export function migrateStoredTheme(raw: string | null): ThemeChoice {
  switch (raw) {
    case "holographic":
    case "macos":
    case "dark":
    case "light":
    case "system":
      return raw;
    default:
      return "holographic";
  }
}

export function migrateLegacyTheme(raw: string | null): ThemeChoice | null {
  if (raw === "dark" || raw === "system") return "holographic";
  if (raw === "light") return "light";
  return null;
}
