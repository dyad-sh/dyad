import { expect } from "@playwright/test";
import { testWithConfig, Timeout } from "./helpers/test_helper";

const testWithRealCatalog = testWithConfig({
  preLaunchHook: async () => {
    process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL =
      "https://api.dyad.sh/v1/language-model-catalog";
  },
  postLaunchHook: async () => {
    delete process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL;
  },
});

testWithRealCatalog(
  "dynamic models - loads real catalog from api.dyad.sh",
  async ({ po }) => {
    await po.setUp();

    // Open model picker and wait for providers to load from real API
    await po.page.getByTestId("model-picker").click();

    // Wait for loading to finish (real API may take a moment)
    await expect(po.page.getByText("Loading models...")).not.toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Provider submenus now live under "More models"
    await po.page.getByText("More models", { exact: true }).click();

    // Verify primary providers appear from the real catalog
    await expect(po.page.getByText("OpenAI", { exact: true })).toBeVisible();
    await expect(po.page.getByText("Anthropic", { exact: true })).toBeVisible();

    // Select OpenAI submenu and verify models submenu header appears
    await po.page.getByText("OpenAI", { exact: true }).click();
    await expect(po.page.getByText("OpenAI Models")).toBeVisible({
      timeout: Timeout.SHORT,
    });
  },
);
