import { expect } from "@playwright/test";
import { testWithConfig } from "./helpers/test_helper";

const testWithRemoteCatalog = testWithConfig({
  preLaunchHook: async ({ fakeLlmPort }) => {
    process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL = `http://localhost:${fakeLlmPort}/api/language-model-catalog`;
  },
  postLaunchHook: async () => {
    delete process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL;
  },
});

const testWithFallbackCatalog = testWithConfig({
  preLaunchHook: async ({ fakeLlmPort }) => {
    process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL = `http://localhost:${fakeLlmPort}/missing-language-model-catalog`;
  },
  postLaunchHook: async () => {
    delete process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL;
  },
});

testWithRemoteCatalog(
  "dynamic models - uses remote catalog when API is available",
  async ({ po }) => {
    await po.setUp();

    await po.page.getByTestId("model-picker").click();
    // Models appear directly in the flat tier list.
    await expect(po.page.getByText("GPT 5.2", { exact: true })).toBeVisible();
    await expect(
      po.page.getByText("GPT 5.2 Remote Only", { exact: true }),
    ).toBeVisible();
  },
);

testWithFallbackCatalog(
  "dynamic models - falls back to local catalog when API is unavailable",
  async ({ po }) => {
    await po.setUp();

    await po.page.getByTestId("model-picker").click();
    // Models appear directly in the flat tier list.
    await expect(po.page.getByText("GPT 5.2", { exact: true })).toBeVisible();
    await expect(
      po.page.getByText("GPT 5.2 Remote Only", { exact: true }),
    ).not.toBeVisible();
    await expect(
      po.page.getByText("GPT 5.2 Remote", { exact: true }),
    ).not.toBeVisible();
  },
);
