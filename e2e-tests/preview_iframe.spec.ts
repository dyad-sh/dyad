import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("preview iframe has sandbox attributes", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("hi");
  expect(
    await po.previewPanel.getPreviewIframeElement().getAttribute("sandbox"),
  ).toMatchSnapshot();
});
