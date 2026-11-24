import { describe, expect, it } from "vitest";

import i18n from "./index";
import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
import enSettings from "./locales/en/settings.json";
import itChat from "./locales/it/chat.json";
import itCommon from "./locales/it/common.json";
import itErrors from "./locales/it/errors.json";
import itHome from "./locales/it/home.json";
import itSettings from "./locales/it/settings.json";
import { LanguageSchema } from "@/lib/schemas";

type Catalog = { [key: string]: string | Catalog };

const NAMESPACES: Record<string, { en: Catalog; it: Catalog }> = {
  common: { en: enCommon, it: itCommon },
  settings: { en: enSettings, it: itSettings },
  chat: { en: enChat, it: itChat },
  home: { en: enHome, it: itHome },
  errors: { en: enErrors, it: itErrors },
};

function flatten(catalog: Catalog, prefix = ""): Record<string, string> {
  return Object.entries(catalog).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === "string") {
        acc[`${prefix}${key}`] = value;
      } else {
        Object.assign(acc, flatten(value, `${prefix}${key}.`));
      }
      return acc;
    },
    {},
  );
}

const placeholders = (text: string) =>
  (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

describe("Italian locale", () => {
  it("is an accepted language setting", () => {
    expect(LanguageSchema.safeParse("it").success).toBe(true);
  });

  it.each(Object.entries(NAMESPACES))(
    "%s has the same keys and placeholders as English",
    (_namespace, { en, it: itCatalog }) => {
      const enFlat = flatten(en);
      const itFlat = flatten(itCatalog);

      expect(Object.keys(itFlat).sort()).toEqual(Object.keys(enFlat).sort());
      for (const [key, value] of Object.entries(itFlat)) {
        expect(value.trim(), key).not.toBe("");
        expect(placeholders(value), key).toEqual(placeholders(enFlat[key]));
      }
    },
  );

  it("registers every Italian namespace with i18next", async () => {
    await i18n.changeLanguage("it");
    try {
      expect(i18n.t("itemCount", { ns: "common", count: 2 })).toBe(
        "2 elementi",
      );
      expect(i18n.t("title", { ns: "settings" })).toBe("Impostazioni");
      expect(i18n.t("newChat", { ns: "chat" })).toBe("Nuova chat");
      expect(i18n.t("openInNewWindow", { ns: "home" })).toBe(
        "Apri in una nuova finestra",
      );
      expect(i18n.t("unknown", { ns: "errors" })).toBe(
        "Si è verificato un errore sconosciuto",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("resolves Italian plural forms", async () => {
    await i18n.changeLanguage("it");
    try {
      // Italian treats only 1 as singular.
      expect(i18n.t("itemCount", { count: 0 })).toBe("0 elementi");
      expect(i18n.t("itemCount", { count: 1 })).toBe("1 elemento");
      expect(i18n.t("itemCount", { count: 2 })).toBe("2 elementi");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
