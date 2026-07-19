import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("switches to Simplified Chinese and keeps the renderer localized", async ({
  po,
}) => {
  const missingKeyWarnings: string[] = [];
  po.page.on("console", (message) => {
    if (/i18next.*missingkey|missingkey.*i18next/i.test(message.text())) {
      missingKeyWarnings.push(message.text());
    }
  });

  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.page.locator('a[href="/settings"]').click();
  await expect(
    po.page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  await po.page.getByRole("combobox", { name: "Language" }).click();
  await po.page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(
    po.page.getByRole("heading", { level: 1, name: "设置" }),
  ).toBeVisible();
  await expect.poll(() => po.settings.recordSettings().language).toBe("zh-CN");

  await po.page.reload();
  await expect(
    po.page.getByRole("heading", { level: 1, name: "设置" }),
  ).toBeVisible();
  await expect(po.page.getByRole("combobox", { name: "语言" })).toContainText(
    "简体中文",
  );

  await po.page.locator('a[href="/"]').click();
  await expect(
    po.page.getByRole("heading", { name: "你想构建什么？" }),
  ).toBeVisible();
  await expect(po.page.getByTestId("home-chat-input-container")).toBeVisible();

  const chatList = po.page.getByTestId("chat-list-container");
  if (!(await chatList.isVisible())) {
    await po.page.locator('a[href="/"]').hover();
  }
  await expect(chatList).toBeVisible();
  await chatList.locator('[data-testid^="chat-list-item-"]').first().click();
  await expect(po.page.getByTestId("chat-input-container")).toBeVisible();
  await po.previewPanel.selectPreviewMode("preview");
  await expect(po.page.locator("#preview-panel")).toBeVisible();
  await expect(po.page.getByTestId("preview-mode-button")).toContainText(
    "预览",
  );

  await po.page.locator('a[href="/settings"]').click();
  await expect(
    po.page.getByRole("button", { name: "重置所有内容", exact: true }),
  ).toBeVisible();
  await po.page
    .getByRole("button", { name: "重置所有内容", exact: true })
    .click();
  await expect(
    po.page.getByText(
      "您确定要重置所有内容吗？这将删除您所有的应用、聊天记录和设置。此操作无法撤销。",
      { exact: true },
    ),
  ).toBeVisible();
  await po.page.getByRole("button", { name: "取消", exact: true }).click();

  expect(missingKeyWarnings).toEqual([]);
});
