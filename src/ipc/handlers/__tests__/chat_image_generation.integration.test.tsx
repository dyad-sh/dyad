import fs from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import { messages } from "@/db/schema";
import type { UserSettings } from "@/lib/schemas";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const PRO_SETTINGS: Partial<UserSettings> = {
  enableDyadPro: true,
  providerSettings: {
    auto: {
      apiKey: { value: "testdyadkey" },
    },
  },
};

describe("chat image generation (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      engine: true,
      testBuild: true,
      settings: {
        isTestMode: true,
        ...PRO_SETTINGS,
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("generates an image from the chat menu and auto-adds it when sending", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const prompt = "A beautiful sunset over mountains";
    const menuTrigger = await screen.findByTestId("auxiliary-actions-menu");
    menuTrigger.focus();
    fireEvent.keyDown(menuTrigger, { key: "ArrowDown" });

    const generateImageItem = await screen.findByTestId(
      "generate-image-menu-item",
    );
    fireEvent.pointerDown(generateImageItem);
    fireEvent.pointerUp(generateImageItem);
    fireEvent.click(generateImageItem);

    const dialog = await harness.findDialog("Generate Image");
    const promptInput = await screen.findByPlaceholderText(
      "Describe the image you want to create...",
    );
    fireEvent.change(promptInput, { target: { value: prompt } });

    const generateButton = await screen.findByRole("button", {
      name: "Generate",
    });
    await waitFor(() =>
      expect((generateButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(generateButton);

    await waitFor(() => expect(dialog.isConnected).toBe(false));

    const generatedImage = await screen.findByAltText(prompt, undefined, {
      timeout: 20_000,
    });
    const generatedSrc = generatedImage.getAttribute("src") ?? "";
    const fileName = decodeURIComponent(generatedSrc.split("/").at(-1) ?? "");
    expect(fileName).toMatch(/^generated_a_beautiful_sunset_over_mo/);
    expect(fileName.endsWith(".png")).toBe(true);

    const mediaPath = path.join(harness.appDir, ".dyad", "media", fileName);
    expect(fs.existsSync(mediaPath)).toBe(true);

    const sendButton = await screen.findByRole("button", {
      name: /^(sendMessage|Send message)$/,
    });
    await waitFor(() =>
      expect((sendButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(sendButton);

    await waitFor(() => expect(screen.queryByAltText(prompt)).toBeNull());
    await screen.findByRole(
      "button",
      { name: `Expand image: ${fileName}` },
      { timeout: 20_000 },
    );

    const [userMessage] = await harness.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.id);
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toContain(fileName);
    expect(userMessage.content).toContain("<dyad-attachment");
  }, 60_000);
});
