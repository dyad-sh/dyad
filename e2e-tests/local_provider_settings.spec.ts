import { expect } from "@playwright/test";
import { test as testWithPo } from "./helpers/test_helper";

testWithPo("Local provider endpoint settings persist", async ({ po }) => {
  await po.setUp();
  await po.goToSettingsTab();

  await expect(po.page.getByText("Ollama", { exact: true })).toBeVisible();

  await po.page.getByText("Ollama", { exact: true }).click();
  await po.page.waitForSelector('h1:has-text("Configure Ollama")', {
    state: "visible",
    timeout: 5000,
  });

  const ollamaInput = po.page.getByLabel(
    "Local model endpoint (Ollama-compatible)",
  );
  await expect(ollamaInput).toBeVisible();
  await expect(
    po.page.getByText("LM Studio API endpoint", { exact: true }),
  ).toHaveCount(0);

  const ollamaEndpoint = "http://localhost:11435";
  await ollamaInput.fill(ollamaEndpoint);
  await po.page.getByRole("button", { name: "Save" }).click();
  await expect(ollamaInput).toHaveValue(ollamaEndpoint);

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await expect(po.page.getByText("AI Providers")).toBeVisible();

  await po.page.getByText("Ollama", { exact: true }).click();
  await po.page.waitForSelector('h1:has-text("Configure Ollama")', {
    state: "visible",
    timeout: 5000,
  });
  await expect(ollamaInput).toHaveValue(ollamaEndpoint);

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await expect(po.page.getByText("AI Providers")).toBeVisible();

  await po.page.getByText("LM Studio", { exact: true }).click();
  await po.page.waitForSelector('h1:has-text("Configure LM Studio")', {
    state: "visible",
    timeout: 5000,
  });

  const lmStudioInput = po.page.getByLabel("LM Studio API endpoint");
  await expect(lmStudioInput).toBeVisible();
  await expect(
    po.page.getByText("Local model endpoint (Ollama-compatible)", {
      exact: true,
    }),
  ).toHaveCount(0);

  const lmStudioEndpoint = "http://localhost:12345";
  await lmStudioInput.fill(lmStudioEndpoint);
  await po.page.getByRole("button", { name: "Save" }).click();
  await expect(lmStudioInput).toHaveValue(lmStudioEndpoint);

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await expect(po.page.getByText("AI Providers")).toBeVisible();

  await po.page.getByText("LM Studio", { exact: true }).click();
  await po.page.waitForSelector('h1:has-text("Configure LM Studio")', {
    state: "visible",
    timeout: 5000,
  });
  await expect(lmStudioInput).toHaveValue(lmStudioEndpoint);
});
