import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("renders the first page", async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  await expect(page.getByTestId("home-chat-input-container")).toBeVisible();
});
