import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("database panel - shows tables and data, supports SQL editor", async ({
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

  // Verify the sidebar is shown with "Manage your back-end" header
  await expect(po.page.getByText("Manage your back-end")).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Database section should be active by default, verify tables list is shown
  await expect(po.page.getByText("Tables (3)")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Verify fake tables are displayed in the list (use exact: true to avoid matching sidebar "Users")
  await expect(
    po.page.getByRole("button", { name: "users", exact: true }),
  ).toBeVisible();
  await expect(
    po.page.getByRole("button", { name: "posts", exact: true }),
  ).toBeVisible();
  await expect(
    po.page.getByRole("button", { name: "comments", exact: true }),
  ).toBeVisible();

  // Click on the users table to view its data
  await po.page.getByRole("button", { name: "users", exact: true }).click();

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
  await po.page.getByRole("button", { name: "posts", exact: true }).click();

  // Verify posts table data
  await expect(po.page.getByText("Schema: posts")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByText("Rows (2)")).toBeVisible();
  // Check actual row data (post titles are unique)
  await expect(po.page.getByText("Hello World")).toBeVisible();
  await expect(po.page.getByText("Learning Supabase")).toBeVisible();

  // --- SQL Editor Tests ---

  // Switch to SQL tab
  await po.page.getByRole("tab", { name: "SQL" }).click();

  // Verify SQL editor is visible
  await expect(po.page.locator(".monaco-editor")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Clear the editor and type a custom query
  // The Monaco editor has a default value, so we use keyboard shortcuts to select all and replace
  // Use force: true because Monaco overlays intercept pointer events
  await po.page.locator(".monaco-editor textarea").click({ force: true });
  await po.page.keyboard.press("ControlOrMeta+a");
  await po.page.keyboard.type("SELECT * FROM posts");

  // Click the Run button to execute the query
  await po.page.getByRole("button", { name: "Run" }).click();

  // Verify the results show the posts data
  await expect(po.page.getByText("Hello World")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByText("Learning Supabase")).toBeVisible();

  // Verify the row count display
  await expect(po.page.getByText("2 rows")).toBeVisible();

  // Switch back to Tables tab to verify tab switching works
  await po.page.getByRole("tab", { name: "Tables" }).click();
  await expect(po.page.getByText("Tables (3)")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});
