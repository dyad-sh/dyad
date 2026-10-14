import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";
import type { PageObject } from "./helpers/page-objects/PageObject";
import path from "path";
import fs from "fs";

test("env var", async ({ po }) => {
  await po.sendPrompt("tc=1");
  const appPath = await po.appManagement.getCurrentAppPath();

  await po.previewPanel.selectPreviewMode("configure");

  // Create a new env var
  await addEnvVar(po, { key: "aKey", value: "aValue" });
  await snapshotEnvVar({ appPath, name: "create-aKey" });

  // Create second env var
  await addEnvVar(po, { key: "bKey", value: "bValue" });
  await snapshotEnvVar({ appPath, name: "create-bKey" });

  // Edit second env var
  await po.page.getByTestId("edit-env-var-bKey").click();
  await po.page.getByRole("textbox", { name: "Value" }).click();
  await po.page.getByRole("textbox", { name: "Value" }).fill("bValue2");
  await po.page.getByTestId("save-edit-env-var").click();
  await expect(po.page.getByText("bValue2")).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });
  await snapshotEnvVar({ appPath, name: "edit-bKey" });

  // Delete first env var
  await po.page.getByTestId("delete-env-var-aKey").click();
  await expect(po.page.getByTestId("edit-env-var-aKey")).toHaveCount(0, {
    timeout: Timeout.EXTRA_LONG,
  });
  await snapshotEnvVar({ appPath, name: "delete-aKey" });
});

async function addEnvVar(
  po: PageObject,
  { key, value }: { key: string; value: string },
) {
  await po.page
    .getByRole("button", { name: "Add Environment Variable" })
    .click();
  await po.page.getByRole("textbox", { name: "Key" }).click();
  await po.page.getByRole("textbox", { name: "Key" }).fill(key);

  await po.page.getByRole("textbox", { name: "Value" }).click();
  await po.page.getByRole("textbox", { name: "Value" }).fill(value);

  await po.page.getByRole("button", { name: "Save" }).click();
  // The form closes as soon as Save is clicked, but the write itself queues
  // behind the app's runtime-config claim, which the preview holds for the
  // whole dependency install. Each save also builds its list from the one
  // the panel currently shows, so the next edit must wait for this row to
  // land rather than for the form to close.
  await expect(po.page.getByTestId(`edit-env-var-${key}`)).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });
}

async function snapshotEnvVar({
  appPath,
  name,
}: {
  appPath: string;
  name: string;
}) {
  await expect(() => {
    const envFile = path.join(appPath, ".env.local");
    const envFileContent = fs.readFileSync(envFile, "utf8");
    expect(envFileContent).toMatchSnapshot({ name });
  }).toPass({ timeout: Timeout.MEDIUM });
}
