import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
import path from "path";
import fs from "fs";

test("env var", async ({ po }) => {
  await po.sendPrompt("tc=1");
  const appPath = await po.getCurrentAppPath();

  await po.selectPreviewMode("configure");

  // Create a new env var
  await po.page
    .getByRole("button", { name: "Add Environment Variable" })
    .click();
  await po.page.getByRole("textbox", { name: "Key" }).click();
  await po.page.getByRole("textbox", { name: "Key" }).fill("aKey");

  await po.page.getByRole("textbox", { name: "Value" }).click();
  await po.page.getByRole("textbox", { name: "Value" }).fill("aValue");

  await po.page.getByRole("button", { name: "Save" }).click();
  await snapshotEnvVar({ appPath, name: "create-aKey" });

  // Create second env var
  await po.page
    .getByRole("button", { name: "Add Environment Variable" })
    .click();
  await po.page.getByRole("textbox", { name: "Key" }).click();
  await po.page.getByRole("textbox", { name: "Key" }).fill("bKey");

  await po.page.getByRole("textbox", { name: "Value" }).click();
  await po.page.getByRole("textbox", { name: "Value" }).fill("bValue");

  await po.page.getByRole("button", { name: "Save" }).click();
  await snapshotEnvVar({ appPath, name: "create-bKey" });

  // Edit second env var
  await po.page.getByTestId("edit-env-var-bKey").click();
  await po.page.getByRole("textbox", { name: "Value" }).click();
  await po.page.getByRole("textbox", { name: "Value" }).fill("bValue2");
  await po.page.getByTestId("save-edit-env-var").click();
  await snapshotEnvVar({ appPath, name: "edit-bKey" });

  // Delete first env var
  await po.page.getByTestId("delete-env-var-aKey").click();
  await snapshotEnvVar({ appPath, name: "delete-aKey" });
});

async function snapshotEnvVar({
  appPath,
  name,
}: {
  appPath: string;
  name: string;
}) {
  expect(() => {
    const envFile = path.join(appPath, ".env.local");
    const envFileContent = fs.readFileSync(envFile, "utf8");
    expect(envFileContent).toMatchSnapshot({ name });
  }).toPass();
}
