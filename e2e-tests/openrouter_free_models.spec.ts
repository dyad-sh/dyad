import { expect } from "@playwright/test";
import { testWithConfig } from "./helpers/test_helper";

const testOpenRouter = testWithConfig({
  preLaunchHook: async () => {
    process.env.OPENROUTER_API_KEY = "or-test-key";
  },
});

testOpenRouter(
  "openrouter free models are listed in the model picker",
  async ({ po }) => {
    await po.setUp();

    await po.page.getByTestId("model-picker").click();
    await po.page.getByText("Other AI providers", { exact: true }).click();
    await po.page.getByText("OpenRouter", { exact: true }).click();

    await expect(
      po.page.getByText("Free models", { exact: true }),
    ).toBeVisible();
    await po.page.getByText("Free models", { exact: true }).click();

    await expect(
      po.page.getByText("OpenRouter Free Models", { exact: true }),
    ).toBeVisible();

    await expect(
      po.page.getByRole("menuitem").filter({ hasText: "Free (OpenRouter)" }),
    ).toBeVisible();
  },
);
