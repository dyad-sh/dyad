import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("tool permissions can be identified and changed with the keyboard", async ({
  po,
}) => {
  await po.navigation.goToSettingsTab();
  await po.page
    .getByRole("button", { name: "Build and Agent Permissions", exact: true })
    .click();

  const permission = po.page.getByRole("combobox", {
    name: "add_dependency",
    exact: true,
  });
  await expect(permission).toBeVisible();
  await expect(permission).toContainText("ask", { ignoreCase: true });
  const otherPermission = po.page.getByRole("combobox", {
    name: "execute_sql",
    exact: true,
  });
  await expect(otherPermission).toContainText("ask", { ignoreCase: true });

  await permission.focus();
  await permission.press("Enter");
  await expect(
    po.page.getByRole("option", { name: "Never allow" }),
  ).toBeVisible();
  await po.page.keyboard.press("End");
  await po.page.keyboard.press("Enter");
  await expect(permission).toContainText("never", { ignoreCase: true });
  await expect(permission).toBeFocused();
  await expect(otherPermission).toContainText("ask", { ignoreCase: true });

  await expect
    .poll(() => po.settings.recordSettings().agentToolConsents)
    .toMatchObject({ add_dependency: "never" });
  await po.navigation.goToAppsTab();
  await po.navigation.goToSettingsTab();
  await expect(permission).toContainText("never", { ignoreCase: true });
  await expect(otherPermission).toContainText("ask", { ignoreCase: true });

  const disclosure = po.page.getByRole("button", {
    name: /^Default allowed tools/,
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(
    po.page.getByRole("combobox", { name: "read_file", exact: true }),
  ).toBeVisible();
  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(
    po.page.getByRole("combobox", { name: "read_file", exact: true }),
  ).toBeHidden();
});
