import { useEffect, useMemo } from "react";

import { useSettings } from "@/hooks/useSettings";
import { UiFontFamilySchema, type UiFontFamily } from "@/lib/schemas";
import {
  DEFAULT_UI_FONT_FAMILY,
  UI_FONT_FAMILY_STACKS,
} from "@/shared/settings_defaults";

/**
 * Resolves the configured UI font to a font id, falling back to the default
 * when the stored value is missing or no longer a known option.
 */
export function resolveUiFontFamily(value: unknown): UiFontFamily {
  const parsed = UiFontFamilySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_UI_FONT_FAMILY;
}

/**
 * Applies the `uiFontFamily` setting to the document root.
 *
 * The font stack is written to the `--default-font-family` custom property,
 * which the Tailwind theme (`--font-sans`) and the `body` rule both read.
 * Writing the variable rather than a class means the whole app follows the
 * setting without every component opting in.
 */
export function useUiFontFamily() {
  const { settings } = useSettings();

  const fontFamily: UiFontFamily = useMemo(
    () => resolveUiFontFamily(settings?.uiFontFamily),
    [settings?.uiFontFamily],
  );

  useEffect(() => {
    const root = window.document.documentElement;
    const previous = root.style.getPropertyValue("--default-font-family");
    root.style.setProperty(
      "--default-font-family",
      UI_FONT_FAMILY_STACKS[fontFamily],
    );

    return () => {
      if (previous) {
        root.style.setProperty("--default-font-family", previous);
      } else {
        root.style.removeProperty("--default-font-family");
      }
    };
  }, [fontFamily]);

  return fontFamily;
}
