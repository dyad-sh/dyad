import { describe, expect, it } from "vitest";

import en from "./locales/en/home.json";
import es from "./locales/es/home.json";
import ko from "./locales/ko/home.json";
import ptBR from "./locales/pt-BR/home.json";
import zhCN from "./locales/zh-CN/home.json";
import tr from "./locales/tr/home.json";
import enChat from "./locales/en/chat.json";
import esChat from "./locales/es/chat.json";
import koChat from "./locales/ko/chat.json";
import ptBRChat from "./locales/pt-BR/chat.json";
import zhCNChat from "./locales/zh-CN/chat.json";
import trChat from "./locales/tr/chat.json";

const LOCALES = { es, ko, "pt-BR": ptBR, "zh-CN": zhCN, tr };
const CHAT_LOCALES = {
  en: enChat,
  es: esChat,
  ko: koChat,
  "pt-BR": ptBRChat,
  "zh-CN": zhCNChat,
  tr: trChat,
};

it.each(Object.entries(CHAT_LOCALES))(
  "%s translates test cleanup statuses",
  (_locale, catalog) => {
    for (const key of [
      "cancellationRemovingTestDatabase",
      "cancellationCleaningTestSandbox",
    ] as const) {
      expect(catalog[key]).toEqual(expect.any(String));
      expect(catalog[key].trim().length).toBeGreaterThan(0);
    }
  },
);

/**
 * Scoped to the Tests panel's run-gate block on purpose. The catalogs as a
 * whole have already drifted, so a full-parity assertion would fail on day one
 * and get deleted; this one covers the strings a run refusal depends on, where
 * falling back to English leaves a non-English user reading an explanation of
 * why nothing works in a language they may not have.
 */
describe("preview.testGate translations", () => {
  const expected = Object.keys(en.preview.testGate).sort();

  it.each(Object.keys(LOCALES))("%s has every key English has", (locale) => {
    const testGate = (
      LOCALES[locale as keyof typeof LOCALES].preview as {
        testGate?: Record<string, string>;
      }
    ).testGate;
    expect(Object.keys(testGate ?? {}).sort()).toEqual(expected);
  });

  it.each(Object.keys(LOCALES))(
    "%s keeps the runtime placeholder",
    (locale) => {
      const testGate = (
        LOCALES[locale as keyof typeof LOCALES].preview as {
          testGate: Record<string, string>;
        }
      ).testGate;
      // Dropping `{{runtime}}` in translation would leave the banner naming no
      // runtime at all, which is the one detail that makes it actionable.
      expect(testGate.neonRefusalRuntime).toContain("{{runtime}}");
    },
  );
});
