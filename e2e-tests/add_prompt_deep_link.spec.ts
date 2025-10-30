import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("add prompt via deep link with base64-encoded data", async ({
  po,
  electronApp,
}) => {
  await po.setUp();
  await po.goToLibraryTab();

  // Verify library is empty initially
  await expect(po.page.getByTestId("prompt-card")).not.toBeVisible();

  // Create the prompt data to be encoded
  const promptData = {
    title: "Deep Link Test Prompt",
    description: "A prompt created via deep link",
    content: "You are a helpful assistant. Please help with:\n\n[task here]",
  };

  // Encode the data as base64 (matching the pattern in main.ts)
  const base64Data = Buffer.from(JSON.stringify(promptData)).toString(
    "base64",
  );
  const deepLinkUrl = `dyad://add-prompt?data=${encodeURIComponent(base64Data)}`;

  console.log("Triggering deep link:", deepLinkUrl);

  // Trigger the deep link by emitting the 'open-url' event in the main process
  await electronApp.evaluate(
    ({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    },
    deepLinkUrl,
  );

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

  // Verify the prompt was created and appears in the library
  await expect(po.page.getByTestId("prompt-card")).toBeVisible();
  await expect(po.page.getByText(promptData.title)).toBeVisible();
  await expect(po.page.getByText(promptData.description)).toBeVisible();
  await expect(po.page.getByText(promptData.content)).toBeVisible();
});

test("add prompt via deep link with very long content", async ({
  po,
  electronApp,
}) => {
  await po.setUp();
  await po.goToLibraryTab();

  // Create a prompt with very long content to test base64 encoding advantage
  const longContent = `You are an expert software architect. Your task is to:

1. Analyze the provided codebase structure
2. Identify potential architectural issues
3. Suggest improvements following SOLID principles
4. Provide detailed refactoring recommendations

Context:
${Array(50)
  .fill(
    "This is a sample line of content to test how well the deep link handles long strings. ",
  )
  .join("\n")}

Please be thorough in your analysis and provide actionable feedback.`;

  const promptData = {
    title: "Long Content Prompt",
    description: "Testing deep link with lengthy prompt content",
    content: longContent,
  };

  const base64Data = Buffer.from(JSON.stringify(promptData)).toString(
    "base64",
  );
  const deepLinkUrl = `dyad://add-prompt?data=${encodeURIComponent(base64Data)}`;

  console.log("Deep link length:", deepLinkUrl.length);

  // Trigger the deep link
  await electronApp.evaluate(
    ({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    },
    deepLinkUrl,
  );

  // Wait for dialog and verify content is correctly prefilled
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).toBeVisible();

  await expect(po.page.getByRole("textbox", { name: "Title" })).toHaveValue(
    promptData.title,
  );
  await expect(po.page.getByRole("textbox", { name: "Content" })).toHaveValue(
    longContent,
  );

  // Save and verify
  await po.page.getByRole("button", { name: "Save" }).click();
  await expect(po.page.getByText(promptData.title)).toBeVisible();
});

test("add prompt via deep link with special characters", async ({
  po,
  electronApp,
}) => {
  await po.setUp();
  await po.goToLibraryTab();

  // Test with special characters that might break URL encoding
  const promptData = {
    title: 'Prompt with "quotes" & special chars',
    description: "Testing: <script>alert('xss')</script> & symbols!@#$%^&*()",
    content: `Here's content with:
- Newlines
- "Double quotes"
- 'Single quotes'
- Symbols: !@#$%^&*()
- Unicode: 🚀 🎉 ✨
- Backslashes: \\n \\t \\r
- Brackets: {}, [], ()`,
  };

  const base64Data = Buffer.from(JSON.stringify(promptData)).toString(
    "base64",
  );
  const deepLinkUrl = `dyad://add-prompt?data=${encodeURIComponent(base64Data)}`;

  // Trigger the deep link
  await electronApp.evaluate(
    ({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    },
    deepLinkUrl,
  );

  // Verify prefilled data
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).toBeVisible();

  await expect(po.page.getByRole("textbox", { name: "Title" })).toHaveValue(
    promptData.title,
  );
  await expect(
    po.page.getByRole("textbox", { name: "Description (optional)" }),
  ).toHaveValue(promptData.description);
  await expect(po.page.getByRole("textbox", { name: "Content" })).toHaveValue(
    promptData.content,
  );

  // Save and verify special characters are preserved
  await po.page.getByRole("button", { name: "Save" }).click();
  await expect(po.page.getByText(promptData.title)).toBeVisible();
});

test("add prompt deep link with invalid base64 shows error", async ({
  po,
  electronApp,
}) => {
  await po.setUp();

  // Create an invalid deep link with malformed base64
  const invalidDeepLinkUrl = "dyad://add-prompt?data=invalid-base64!!!";

  // Listen for dialog errors
  

  // Trigger the invalid deep link
  await electronApp.evaluate(
    ({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    },
    invalidDeepLinkUrl,
  );

  // The dialog should NOT open since the data is invalid
  // Wait a bit to ensure no dialog appears
  await po.page.waitForTimeout(500);
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).not.toBeVisible();
});

test("add prompt deep link with missing data parameter shows error", async ({
  po,
  electronApp,
}) => {
  await po.setUp();

  // Create a deep link without the required data parameter
  const invalidDeepLinkUrl = "dyad://add-prompt";

  // Trigger the invalid deep link
  await electronApp.evaluate(
    ({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    },
    invalidDeepLinkUrl,
  );

  // The dialog should NOT open
  await po.page.waitForTimeout(500);
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).not.toBeVisible();
});

test("can cancel deep link prompt dialog and reopen manually", async ({
  po,
  electronApp,
}) => {
  await po.setUp();
  await po.goToLibraryTab();

  const promptData = {
    title: "Cancelable Prompt",
    description: "Test canceling the dialog",
    content: "This prompt should not be saved",
  };

  const base64Data = Buffer.from(JSON.stringify(promptData)).toString(
    "base64",
  );
  const deepLinkUrl = `dyad://add-prompt?data=${encodeURIComponent(base64Data)}`;

  // Trigger the deep link
  await electronApp.evaluate(
    ({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    },
    deepLinkUrl,
  );

  // Wait for dialog and verify it's open
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).toBeVisible();

  // Cancel the dialog
  await po.page.getByRole("button", { name: "Cancel" }).click();

  // Dialog should close
  await expect(
    po.page.getByRole("dialog").getByText("Create New Prompt"),
  ).not.toBeVisible();

  // Verify prompt was not created
  await expect(po.page.getByTestId("prompt-card")).not.toBeVisible();

  // Open dialog manually and create a different prompt
  await po.createPrompt({
    title: "Manual Prompt",
    content: "This one should be saved",
  });

  // Verify only the manual prompt exists
  await expect(po.page.getByTestId("prompt-card")).toBeVisible();
  await expect(po.page.getByText("Manual Prompt")).toBeVisible();
  await expect(po.page.getByText("Cancelable Prompt")).not.toBeVisible();
});

