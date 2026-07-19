import { describe, expect, test } from "vitest";
import {
  auditRenderer,
  auditSourceText,
  findTranslationKeyIssues,
} from "./sourceAudit";
import { DYNAMIC_TRANSLATION_CALLS } from "./dynamicKeys";
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

describe("renderer i18n source audit", () => {
  test("records static translation calls and Trans defaults", () => {
    const result = auditSourceText(
      `
        import { Trans } from "react-i18next";
        const { t } = useTranslation("settings");
        const { t: tc } = useTranslation("settings");
        const fixedT = i18n.getFixedT(null, "settings", "general");
        t("general.language");
        tc("general.theme");
        fixedT("language");
        t("common:cancel");
        <Trans i18nKey="home:buildMeA" defaults="Build me a {{label}}" />;
        <Trans i18nKey="home:importApp" defaultValue="Import App" />;
        <Trans i18nKey="home:importApp">Import App</Trans>;
      `,
      "src/i18n/fixture.tsx",
    );

    expect(result.translationCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          namespace: "settings",
          keys: ["general.language"],
          dynamic: false,
        }),
        expect.objectContaining({
          namespace: "settings",
          keys: ["general.theme"],
          dynamic: false,
        }),
        expect.objectContaining({
          namespace: "settings",
          keys: ["general.language"],
          dynamic: false,
        }),
        expect.objectContaining({
          namespace: "common",
          keys: ["cancel"],
          dynamic: false,
        }),
        expect.objectContaining({
          namespace: "home",
          keys: ["buildMeA"],
          dynamic: false,
        }),
        expect.objectContaining({
          namespace: "home",
          keys: ["importApp"],
          dynamic: false,
        }),
      ]),
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "Trans defaultValue",
          text: "Build me a {{label}}",
        }),
        expect.objectContaining({
          category: "Trans defaultValue",
          text: "Import App",
        }),
      ]),
    );
  });

  test("reports missing static keys and unregistered dynamic calls", () => {
    const result = auditSourceText(
      `
        const key = condition ? "general.language" : "general.theme";
        const dynamicKey = getKey();
        t(key);
        i18n.t(dynamicKey);
        t(maybeKey || "fallback");
        getFixedT("settings")("general.language");
      `,
      "src/i18n/fixture.tsx",
    );

    const issues = findTranslationKeyIssues(
      [{ filePath: "src/i18n/fixture.tsx", ...result }],
      {
        en: { settings: { "general.language": "Language" } },
        zhCN: { settings: { "general.language": "语言" } },
      },
      [],
    );

    expect(result.translationCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dynamic: true,
          signature: expect.stringContaining("t(key)"),
        }),
        expect.objectContaining({
          dynamic: true,
          signature: expect.stringContaining("i18n.t(dynamicKey)"),
        }),
        expect.objectContaining({
          dynamic: true,
          signature: expect.stringContaining('t(maybeKey || "fallback")'),
        }),
      ]),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("dynamic translation call is not registered"),
      ]),
    );
  });

  test("requires dynamic registry entries to be observed and namespace-qualified", () => {
    const result = auditSourceText(
      `
        const dynamicKey = getKey();
        t(dynamicKey);
      `,
      "src/i18n/fixture.tsx",
    );
    const dynamicCall = result.translationCalls.find((call) => call.dynamic);
    expect(dynamicCall).toBeDefined();

    const resources = {
      en: { settings: { "general.language": "Language" } },
      zhCN: { settings: { "general.language": "语言" } },
    };
    const registryEntry = {
      filePath: "src/i18n/fixture.tsx",
      signature: dynamicCall!.signature,
      keys: ["settings:general.language"],
    };

    expect(
      findTranslationKeyIssues(
        [{ filePath: "src/i18n/fixture.tsx", ...result }],
        resources,
        [registryEntry],
      ),
    ).toEqual([]);

    expect(
      findTranslationKeyIssues(
        [{ filePath: "src/i18n/fixture.tsx", ...result }],
        resources,
        [{ ...registryEntry, signature: "t(otherKey)" }],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("registry entry was not found"),
        expect.stringContaining("dynamic translation call is not registered"),
      ]),
    );

    expect(
      findTranslationKeyIssues(
        [{ filePath: "src/i18n/fixture.tsx", ...result }],
        resources,
        [{ ...registryEntry, keys: ["general.language"] }],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must include a namespace"),
      ]),
    );
  });

  test("accepts an i18next plural base key when both plural leaves exist", () => {
    const result = auditSourceText(
      `
        const { t } = useTranslation("home");
        t("apps.selectedCount", { count: 2 });
      `,
      "src/i18n/fixture.tsx",
    );

    expect(
      findTranslationKeyIssues(
        [{ filePath: "src/i18n/fixture.tsx", ...result }],
        {
          en: {
            home: {
              apps: {
                selectedCount_one: "{{count}} selected",
                selectedCount_other: "{{count}} selected",
              },
            },
          },
          zhCN: {
            home: {
              apps: {
                selectedCount_one: "已选择 {{count}} 个",
                selectedCount_other: "已选择 {{count}} 个",
              },
            },
          },
        },
        [],
      ),
    ).toEqual([]);
  });

  test("leaves technical values such as URLs and environment variables alone", () => {
    const result = auditSourceText(
      `
        <input placeholder="https://example.com" />;
        <code>SUPABASE_URL</code>;
      `,
      "src/i18n/fixture.tsx",
    );

    expect(result.findings).toEqual([]);
  });

  test("finds static fragments in dynamic messages and attributes", () => {
    const result = auditSourceText(
      `
        showError(\`Failed to save ${"${error}"}\`);
        setError(error.message || "Unable to save");
        <button aria-label={\`Open ${"${name}"}\`} />;
        <div>{provider === "supabase" ? "Supabase" : "Neon"}</div>;
        <div>{mode === "system" ? "System" : "Light"}</div>;
      `,
      "src/i18n/fixture.tsx",
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "static message",
          text: "Failed to save",
        }),
        expect.objectContaining({
          category: "static message",
          text: "Unable to save",
        }),
        expect.objectContaining({ category: "aria-label", text: "Open" }),
      ]),
    );
    expect(result.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "supabase" }),
        expect.objectContaining({ text: "system" }),
      ]),
    );
  });

  test("audits toast member calls", () => {
    const result = auditSourceText(
      `
        toast.success("Saved");
        toast.error(\`Failed ${"${error}"}\`);
      `,
      "src/i18n/fixture.tsx",
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "static message", text: "Saved" }),
        expect.objectContaining({ category: "static message", text: "Failed" }),
      ]),
    );
  });

  test("does not allow ordinary uppercase or hyphenated UI text", () => {
    const result = auditSourceText(
      `
        <span>SAVE</span>;
        <span>Sign-in</span>;
      `,
      "src/i18n/fixture.tsx",
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "SAVE" }),
        expect.objectContaining({ text: "Sign-in" }),
      ]),
    );
  });

  test("does not leave hard-coded English UI text in renderer files", () => {
    const roots = ["src/app", "src/pages", "src/components", "src/pro/ui"];
    const auditedFiles = auditRenderer(roots);
    const findings = auditedFiles.flatMap(({ findings: fileFindings }) =>
      fileFindings.map(
        ({ filePath, line, category, text }) =>
          `${filePath}:${line} [${category}] ${text}`,
      ),
    );
    const translationIssues = findTranslationKeyIssues(
      auditedFiles,
      {
        en: {
          common: enCommon,
          settings: enSettings,
          chat: enChat,
          home: enHome,
          errors: enErrors,
        },
        zhCN: {
          common: zhCNCommon,
          settings: zhCNSettings,
          chat: zhCNChat,
          home: zhCNHome,
          errors: zhCNErrors,
        },
      },
      DYNAMIC_TRANSLATION_CALLS,
    );

    expect([...findings, ...translationIssues]).toEqual([]);
  });

  test("ignores CSS text inside style elements", () => {
    const result = auditSourceText(
      `<style>{\`@keyframes blink { from, to { opacity: 0 } }\`}</style>`,
      "src/i18n/fixture.tsx",
    );

    expect(result.findings).toEqual([]);
  });
});
