import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("pause queue", () => {
  test.beforeEach(async ({ po }) => {
    await po.setUp();
  });

  test("pause queue prevents dequeuing after current stream completes", async ({
    po,
  }) => {
    const page = po.page;
    const chatInput = po.chatActions.getChatInput();

    await po.sendPrompt("tc=1 [sleep=medium]", { skipWaitForCompletion: true });

    const stopButton = page.getByRole("button", { name: /cancel generation/i });
    await expect(stopButton).toBeVisible({ timeout: Timeout.MEDIUM });

    for (let i = 1; i <= 4; i++) {
      await chatInput.fill(`message ${i}`);
      await chatInput.press("Enter");
      await expect(page.getByTestId("queue-header")).toContainText(
        new RegExp(`^${i}\\s+Queued`),
        {
          timeout: Timeout.SHORT,
        },
      );
    }

    const queueHeader = page.getByTestId("queue-header");
    await expect(queueHeader).toContainText(/4\s+Queued/, {
      timeout: Timeout.SHORT,
    });

    const pauseButton = queueHeader.getByRole("button", {
      name: /pause queue/i,
    });
    await expect(pauseButton).toBeVisible({ timeout: Timeout.SHORT });
    await pauseButton.click();
    await expect(page.getByText("Paused")).toBeVisible();

    await po.chatActions.waitForChatCompletion();
    await expect(queueHeader).toContainText(/4\s+Queued/);
  });

  test("stopping while paused keeps queue and resume starts sending", async ({
    po,
  }) => {
    const page = po.page;
    const chatInput = po.chatActions.getChatInput();

    await po.sendPrompt("tc=1 [sleep=medium]", { skipWaitForCompletion: true });

    const stopButton = page.getByRole("button", { name: /cancel generation/i });
    await expect(stopButton).toBeVisible({ timeout: Timeout.MEDIUM });

    for (let i = 1; i <= 4; i++) {
      await chatInput.fill(`queued ${i} [sleep=medium]`);
      await chatInput.press("Enter");
    }

    const queueHeader = page.getByTestId("queue-header");
    await expect(queueHeader).toContainText(/4\s+Queued/, {
      timeout: Timeout.SHORT,
    });

    const pauseButton = queueHeader.getByRole("button", {
      name: /pause queue/i,
    });
    await expect(pauseButton).toBeVisible({ timeout: Timeout.SHORT });
    await pauseButton.click();
    await expect(page.getByText("Paused")).toBeVisible();

    await stopButton.click();
    await expect(queueHeader).toContainText(/4\s+Queued/);

    const resumeButton = queueHeader.getByRole("button", {
      name: /resume queue/i,
    });
    await expect(resumeButton).toBeVisible({ timeout: Timeout.SHORT });
    await resumeButton.click();
    await expect(page.getByText("Paused")).not.toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await expect
      .poll(
        async () => {
          const text = (await queueHeader.textContent()) ?? "";
          const match = text.match(/(\d+)\s+Queued/i);
          return match ? Number(match[1]) : 0;
        },
        { timeout: Timeout.LONG },
      )
      .toBeLessThan(4);
  });

  test("sending while stopped with paused queue sends immediately and keeps queue", async ({
    po,
  }) => {
    const page = po.page;
    const chatInput = po.chatActions.getChatInput();

    await po.sendPrompt("tc=1 [sleep=medium]", { skipWaitForCompletion: true });

    const stopButton = page.getByRole("button", { name: /cancel generation/i });
    await expect(stopButton).toBeVisible({ timeout: Timeout.MEDIUM });

    for (let i = 1; i <= 3; i++) {
      await chatInput.fill(`queued ${i} [sleep=medium]`);
      await chatInput.press("Enter");
    }

    const queueHeader = page.getByTestId("queue-header");
    await expect(queueHeader).toContainText(/3\s+Queued/, {
      timeout: Timeout.SHORT,
    });

    await queueHeader.getByRole("button", { name: /pause queue/i }).click();
    await expect(page.getByText("Paused")).toBeVisible();

    await stopButton.click();
    await expect(queueHeader).toContainText(/3\s+Queued/);

    await chatInput.fill("should send immediately");
    await chatInput.press("Enter");

    const messagesList = page.getByTestId("messages-list");
    await expect(messagesList.getByText("should send immediately")).toBeVisible(
      {
        timeout: Timeout.SHORT,
      },
    );
    await expect(queueHeader).toContainText(/3\s+Queued/);
    await expect(page.getByText("Paused")).toBeVisible();
  });
});
