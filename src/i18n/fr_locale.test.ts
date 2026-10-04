import { describe, expect, it } from "vitest";

import i18n from "./index";
import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
import enSettings from "./locales/en/settings.json";
import frChat from "./locales/fr/chat.json";
import frCommon from "./locales/fr/common.json";
import frErrors from "./locales/fr/errors.json";
import frHome from "./locales/fr/home.json";
import frSettings from "./locales/fr/settings.json";

type Catalog = { [key: string]: string | Catalog };

const NAMESPACES: Record<string, { en: Catalog; fr: Catalog }> = {
  common: { en: enCommon, fr: frCommon },
  settings: { en: enSettings, fr: frSettings },
  chat: { en: enChat, fr: frChat },
  home: { en: enHome, fr: frHome },
  errors: { en: enErrors, fr: frErrors },
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

describe("French locale", () => {
  it.each(Object.entries(NAMESPACES))(
    "%s has the same keys and placeholders as English",
    (_namespace, { en, fr }) => {
      const enFlat = flatten(en);
      const frFlat = flatten(fr);

      expect(Object.keys(frFlat).sort()).toEqual(Object.keys(enFlat).sort());
      for (const [key, value] of Object.entries(frFlat)) {
        expect(value.trim(), key).not.toBe("");
        expect(placeholders(value), key).toEqual(placeholders(enFlat[key]));
      }
    },
  );

  it("registers every French namespace with i18next", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(i18n.t("itemCount", { ns: "common", count: 2 })).toBe(
        "2 éléments",
      );
      expect(i18n.t("title", { ns: "settings" })).toBe("Paramètres");
      expect(i18n.t("newChat", { ns: "chat" })).toBe("Nouveau chat");
      expect(i18n.t("openInNewWindow", { ns: "home" })).toBe(
        "Ouvrir dans une nouvelle fenêtre",
      );
      expect(i18n.t("unknown", { ns: "errors" })).toBe(
        "Une erreur inconnue s'est produite",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("resolves French plural forms", async () => {
    await i18n.changeLanguage("fr");
    try {
      // French treats 0 and 1 as singular.
      expect(i18n.t("itemCount", { count: 0 })).toBe("0 élément");
      expect(i18n.t("itemCount", { count: 1 })).toBe("1 élément");
      expect(i18n.t("itemCount", { count: 2 })).toBe("2 éléments");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
