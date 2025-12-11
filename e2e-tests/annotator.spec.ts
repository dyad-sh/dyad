import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";

testSkipIfWindows(
  "annotator - capture and submit screenshot",
  async ({ po }) => {
    await po.setUpDyadPro({ autoApprove: true });

    // Create a basic app
    await po.sendPrompt("basic");

    // Click the annotator button to activate annotator mode
    await po.clickPreviewAnnotatorButton();

    // Wait for annotator mode to be active
    await po.waitForAnnotatorMode();

    // Submit the screenshot to chat
    await po.clickAnnotatorSubmit();

    await expect(po.getChatInput()).toContainText(
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

    // Get the last message from the dump
    const messages = parsedDump.body.messages;
    const lastMessage = messages[messages.length - 1];

    expect(lastMessage).toBeTruthy();
    expect(lastMessage.content).toBeTruthy();

    // The content is an array with text and image parts
    expect(Array.isArray(lastMessage.content)).toBe(true);

    // Find the text part and verify it mentions the PNG attachment
    const textPart = lastMessage.content.find(
      (part: any) => part.type === "text",
    );
    expect(textPart).toBeTruthy();
    expect(textPart.text).toMatch(/annotated-screenshot-.*\.png/);
    expect(textPart.text).toMatch(/image\/png/);

    // Find the image part and verify it has the correct structure
    const imagePart = lastMessage.content.find(
      (part: any) => part.type === "image_url",
    );
    expect(imagePart).toBeTruthy();
    expect(imagePart.image_url).toBeTruthy();
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);
  },
);
