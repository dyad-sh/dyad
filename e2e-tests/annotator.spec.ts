import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";

testSkipIfWindows(
  "annotator - capture and submit screenshot",
  async ({ po }) => {
    await po.setUpDyadPro({ autoApprove: true });

    // Create a basic app
    await po.sendPrompt("basic");

    const existingPrompt = "Make the primary button easier to find";
    await po.chatActions.getChatInput().fill(existingPrompt);
    await expect(po.chatActions.getChatInput()).toContainText(existingPrompt);

    // Click the annotator button to activate annotator mode
    await po.previewPanel.clickPreviewAnnotatorButton();

    // Wait for annotator mode to be active
    await po.previewPanel.waitForAnnotatorMode();

    // Submit the screenshot to chat
    await po.previewPanel.clickAnnotatorSubmit();

    await expect(po.chatActions.getChatInput()).toContainText(existingPrompt);
    await expect(po.chatActions.getChatInput()).toContainText(
      "Please update the UI based on these screenshots",
    );

    // Verify the screenshot was attached to chat context
    await po.sendPrompt("[dump]");

    // Wait for the LLM response containing the dump path to appear in the UI
    // before attempting to extract it from the messages list
    await po.page.waitForSelector("text=/\\[\\[dyad-dump-path=.*\\]\\]/");

    // Get the dump file path from the messages list
    const messagesListText = await po.page
      .getByTestId("messages-list")
      .textContent();
    const dumpPathMatch = messagesListText?.match(
      /\[\[dyad-dump-path=([^\]]+)\]\]/,
    );

    if (!dumpPathMatch) {
      throw new Error("No dump path found in messages list");
    }

    const dumpFilePath = dumpPathMatch[1];
    const dumpContent = fs.readFileSync(dumpFilePath, "utf-8");
    const parsedDump = JSON.parse(dumpContent);

    // Get the last message from the dump. Engine requests can use either
    // chat-completions (`messages`) or Responses API (`input`) shape.
    const messages = parsedDump.body.messages ?? parsedDump.body.input;
    const lastMessage = messages[messages.length - 1];

    expect(lastMessage).toBeTruthy();
    expect(lastMessage.content).toBeTruthy();

    // The content is an array with text and image parts
    expect(Array.isArray(lastMessage.content)).toBe(true);

    // Find the text part and verify the user command was preserved.
    const textPart = lastMessage.content.find(
      (part: any) => part.type === "text" || part.type === "input_text",
    );
    expect(textPart).toBeTruthy();
    expect(textPart.text).toContain("[dump]");

    // Find the image part and verify the annotated screenshot was attached.
    const imagePart = lastMessage.content.find(
      (part: any) => part.type === "image_url" || part.type === "input_image",
    );
    expect(imagePart).toBeTruthy();
    const imageUrl =
      imagePart.type === "input_image"
        ? imagePart.image_url
        : imagePart.image_url?.url;
    expect(imageUrl).toMatch(/^data:image\/png;base64,/);
  },
);
