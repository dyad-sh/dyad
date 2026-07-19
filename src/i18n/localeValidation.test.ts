import { describe, expect, test } from "vitest";
import i18n from "./index";
import {
  compareResourceKeys,
  compareResourceTokens,
  findPluralDifferences,
} from "./localeValidation";

import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
import enSettings from "./locales/en/settings.json";
import zhCNChat from "./locales/zh-CN/chat.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNErrors from "./locales/zh-CN/errors.json";
import zhCNHome from "./locales/zh-CN/home.json";
import zhCNSettings from "./locales/zh-CN/settings.json";

const resources = {
  common: { en: enCommon, zhCN: zhCNCommon },
  settings: { en: enSettings, zhCN: zhCNSettings },
  chat: { en: enChat, zhCN: zhCNChat },
  home: { en: enHome, zhCN: zhCNHome },
  errors: { en: enErrors, zhCN: zhCNErrors },
} as const;

describe("locale resources", () => {
  test("English and Simplified Chinese have identical nested keys", () => {
    const differences = Object.entries(resources).flatMap(
      ([namespace, localeResources]) => {
        return compareResourceKeys(
          localeResources.en,
          localeResources.zhCN,
          namespace,
        );
      },
    );

    expect(differences).toEqual([]);
  });

  test("Simplified Chinese preserves interpolation and rich-text tokens", () => {
    const differences = Object.entries(resources).flatMap(
      ([namespace, localeResources]) => {
        return compareResourceTokens(
          localeResources.en,
          localeResources.zhCN,
          namespace,
        );
      },
    );

    expect(differences).toEqual([]);
  });

  test("plural forms remain paired in Simplified Chinese", () => {
    const differences = Object.entries(resources).flatMap(
      ([namespace, localeResources]) => {
        return findPluralDifferences(
          localeResources.en,
          localeResources.zhCN,
          namespace,
        );
      },
    );

    expect(differences).toEqual([]);
  });

  test("i18next resolves representative Simplified Chinese values", async () => {
    await i18n.changeLanguage("zh-CN");

    expect(i18n.t("chat:newChat")).toBe("新建聊天");
    expect(i18n.t("common:save")).toBe("保存");
    expect(i18n.t("home:preview.loadingChanges")).not.toContain(
      "preview.loadingChanges",
    );
  });
});
