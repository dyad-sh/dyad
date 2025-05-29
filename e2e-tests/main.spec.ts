import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("renders the first page", async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  await page.waitForSelector("h1");
  const text = await page.$eval("h1", (el) => el.textContent);
  expect(text).toBe("Build your dream app");
});

test("simple message to custom test model", async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByText("Add custom providerConnect to").click();

  // Fill out provider dialog
  await page.getByRole("textbox", { name: "Provider ID" }).fill("testing");
  await page.getByRole("textbox", { name: "Display Name" }).click();
  await page
    .getByRole("textbox", { name: "Display Name" })
    .fill("test-provider");
  await page.getByText("API Base URLThe base URL for").click();
  await page
    .getByRole("textbox", { name: "API Base URL" })
    .fill("http://localhost:3500/v1");
  await page.getByRole("button", { name: "Add Provider" }).click();

  // Create custom model
  await page
    .getByRole("heading", { name: "test-provider Needs Setup" })
    .click();
  await page.getByRole("button", { name: "Add Custom Model" }).click();
  await page.getByRole("textbox", { name: "Model ID*" }).fill("test-model");
  await page.getByRole("textbox", { name: "Model ID*" }).press("Tab");
  await page.getByRole("textbox", { name: "Name*" }).fill("test-model");
  await page.getByRole("button", { name: "Add Model" }).click();

  // Go to apps page and select custom model
  await page.getByRole("link", { name: "Apps" }).click();
  await page.getByRole("button", { name: "Model: Auto" }).click();
  await page.getByText("test-provider").click();
  await page.getByText("test-model").click();

  // Enter prompt and send
  await page.getByRole("textbox", { name: "Ask Dyad to build..." }).click();
  await page.getByRole("textbox", { name: "Ask Dyad to build..." }).fill("hi");
  await page.getByRole("button", { name: "Start new chat" }).click();

  // Make sure it's done
  await expect(page.getByRole("button", { name: "Retry" })).not.toBeVisible();
  await expect(page.getByTestId("messages-list")).toMatchAriaSnapshot();
});
