import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("database panel - shows tables and data when connected", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.sendPrompt("tc=add-supabase");

  // Connect to Supabase (uses fake connection in test mode)
  await po.page.getByText("Set up supabase").click();
  await po.clickConnectSupabaseButton();
  await po.clickBackButton();

  // Navigate to the database panel
  await po.selectPreviewMode("database");

  // Verify the tables list is shown with fake tables
  await expect(po.page.getByText("Tables (3)")).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Verify fake tables are displayed in the list
  await expect(po.page.getByRole("button", { name: "users" })).toBeVisible();
  await expect(po.page.getByRole("button", { name: "posts" })).toBeVisible();
  await expect(po.page.getByRole("button", { name: "comments" })).toBeVisible();

  // Click on the users table to view its data
  await po.page.getByRole("button", { name: "users" }).click();

  // Verify schema section shows column information
  await expect(po.page.getByText("Schema: users")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  // Check that schema columns are visible (using td to target schema table cells)
  await expect(
    po.page.locator("td").filter({ hasText: /^email$/ }),
  ).toBeVisible();
  await expect(
    po.page.locator("td").filter({ hasText: /^created_at$/ }),
  ).toBeVisible();

  // Verify rows section shows data
  await expect(po.page.getByText("Rows (3)")).toBeVisible();
  // Check actual row data (email addresses are unique to rows)
  await expect(po.page.getByText("alice@example.com")).toBeVisible();
  await expect(po.page.getByText("bob@example.com")).toBeVisible();

  // Click on posts table
  await po.page.getByRole("button", { name: "posts" }).click();

  // Verify posts table data
  await expect(po.page.getByText("Schema: posts")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByText("Rows (2)")).toBeVisible();
  // Check actual row data (post titles are unique)
  await expect(po.page.getByText("Hello World")).toBeVisible();
  await expect(po.page.getByText("Learning Supabase")).toBeVisible();
});
