import { test, testWithConfig } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("add prompt via deep link with base64-encoded data", async ({
  po,
  electronApp,
}) => {
  await po.setUp();
  await po.navigation.goToLibraryTab();

  // Verify library is empty initially
  await expect(po.page.getByTestId("library-prompt-card")).not.toBeVisible();

  // Create the prompt data to be encoded
  const promptData = {
    title: "Deep Link Test Prompt",
    description: "A prompt created via deep link",
    content: "You are a helpful assistant. Please help with:\n\n[task here]",
  };

  // Encode the data as base64 (matching the pattern in main.ts)
  const base64Data = Buffer.from(JSON.stringify(promptData)).toString("base64");
  const deepLinkUrl = `dyad://add-prompt?data=${encodeURIComponent(base64Data)}`;

  console.log("Triggering deep link:", deepLinkUrl);

  // Trigger the deep link by emitting the 'open-url' event in the main process
  await electronApp.evaluate(({ app }, url) => {
    app.emit("open-url", { preventDefault: () => {} }, url);
  }, deepLinkUrl);

  // Wait for the dialog to open and verify prefilled data
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).toBeVisible();

  // Verify the form is prefilled with the correct data
  await expect(po.page.getByRole("textbox", { name: "Title" })).toHaveValue(
    promptData.title,
  );
  await expect(
    po.page.getByRole("textbox", { name: "Description (optional)" }),
  ).toHaveValue(promptData.description);
  await expect(po.page.getByRole("textbox", { name: "Content" })).toHaveValue(
    promptData.content,
  );

  // Save the prompt
  await po.page.getByRole("button", { name: "Save" }).click();

  await expect(
    po.page.getByTestId("library-prompt-card"),
  ).toMatchAriaSnapshot();
});

const coldStartPrompt = {
  title: "Cold Start Deep Link",
  description: "Delivered after the renderer loads",
  content: "Verify that a queued startup deep link is not dropped.",
};
const coldStartPayload = Buffer.from(JSON.stringify(coldStartPrompt)).toString(
  "base64",
);
const coldStartTest = testWithConfig({
  launchArgs: [
    `dyad://add-prompt?data=${encodeURIComponent(coldStartPayload)}`,
  ],
});

coldStartTest(
  "queues a cold-start deep link until renderer listeners are ready",
  async ({ po }) => {
    const dialog = po.page.getByRole("dialog");
    await expect(dialog.getByText("Create New Prompt")).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
      coldStartPrompt.title,
    );
    await expect(
      dialog.getByRole("textbox", { name: "Description (optional)" }),
    ).toHaveValue(coldStartPrompt.description);
    await expect(dialog.getByRole("textbox", { name: "Content" })).toHaveValue(
      coldStartPrompt.content,
    );
  },
);
