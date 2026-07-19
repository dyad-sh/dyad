import { describe, expect, test } from "vitest";
import { auditRenderer, findTranslationKeyIssues } from "@/i18n/sourceAudit";
import { DYNAMIC_TRANSLATION_CALLS } from "@/i18n/dynamicKeys";
import enCommon from "@/i18n/locales/en/common.json";
import enHome from "@/i18n/locales/en/home.json";
import zhCNCommon from "@/i18n/locales/zh-CN/common.json";
import zhCNHome from "@/i18n/locales/zh-CN/home.json";

describe("Preview and Plan i18n", () => {
  test("has no hard-coded English UI text or missing home keys", () => {
    const auditedFiles = auditRenderer(["src/components/preview_panel"]);
    const findings = auditedFiles.flatMap(({ findings: fileFindings }) =>
      fileFindings.map(
        ({ filePath, line, category, text }) =>
          `${filePath}:${line} [${category}] ${text}`,
      ),
    );
    const translationIssues = findTranslationKeyIssues(
      auditedFiles,
      {
        en: { common: enCommon, home: enHome },
        zhCN: { common: zhCNCommon, home: zhCNHome },
      },
      DYNAMIC_TRANSLATION_CALLS.filter((entry) =>
        entry.filePath.startsWith("src/components/preview_panel/"),
      ),
    );

    expect([...findings, ...translationIssues]).toEqual([]);
  });
});
