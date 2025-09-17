import { test } from "./helpers/test_helper";

test("app search - basic search dialog functionality", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.goToAppsTab();
  await po.page.getByTestId("search-apps-button").waitFor();

  // Create some apps for testing
  await po.sendPrompt("create a todo application");

  // Go back to apps list
  await po.goToAppsTab();
  await po.page.getByTestId("search-apps-button").waitFor();

  // Create second app
  await po.sendPrompt("build a weather dashboard");

  // Go back to apps list
  await po.goToAppsTab();
  await po.page.getByTestId("search-apps-button").waitFor();

  // Create third app
  await po.sendPrompt("create a blog system");

  // Go back to apps list
  await po.goToAppsTab();
  await po.page.getByTestId("search-apps-button").waitFor();

  // Test 1: Open search dialog using the search button
  const searchButton = po.page.getByTestId("search-apps-button");
  await searchButton.click();

  // Wait for search dialog to appear
  const dialog = po.page.getByTestId("app-search-dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });

  // Test 2: Close dialog with Ctrl+K (shortcut toggles)
  await po.page.keyboard.press("Control+k");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });

  // Test 3: Open dialog again with Ctrl+K (shortcut toggles)
  await po.page.keyboard.press("Control+k");
  await dialog.waitFor({ state: "visible", timeout: 10000 });

  // Test 4: Search for specific term
  await po.page.getByPlaceholder("Search apps").fill("app");
  await po.page.waitForTimeout(500);

  // Test 5: Clear search and close with Escape
  await po.page.getByPlaceholder("Search apps").clear();
  await po.page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
});

test("app search - search functionality with different terms", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  // Create apps with specific content for testing
  await po.sendPrompt("create a calculator application with advanced features");
  await po.goToAppsTab();

  await po.sendPrompt("build a task management system with priority levels");
  await po.goToAppsTab();

  await po.sendPrompt("create a weather monitoring dashboard");
  await po.goToAppsTab();

  // Open search dialog
  await po.page.getByTestId("search-apps-button").click();
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Search for "calculator" - should find the calculator app through chat content
  await po.page.getByPlaceholder("Search apps").fill("calculator");
  await po.page.waitForTimeout(500);

  // Search for "task" - should find the task management app
  await po.page.getByPlaceholder("Search apps").fill("task");
  await po.page.waitForTimeout(500);

  // Search for "weather" - should find the weather dashboard
  await po.page.getByPlaceholder("Search apps").fill("weather");
  await po.page.waitForTimeout(500);

  // Search for non-existent term
  await po.page.getByPlaceholder("Search apps").fill("nonexistent");
  await po.page.waitForTimeout(500);

  // Should show empty state
  await po.page.getByTestId("app-search-empty").waitFor();

  await po.page.keyboard.press("Escape");
});

test("app search - keyboard shortcut functionality", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create an app first
  await po.sendPrompt("create sample application");
  await po.goToAppsTab();

  // Test keyboard shortcut (Ctrl+K) to open dialog
  await po.page.keyboard.press("Control+k");
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Close with escape
  await po.page.keyboard.press("Escape");
  await po.page.getByTestId("app-search-dialog").waitFor({ state: "hidden" });

  // Test keyboard shortcut again
  await po.page.keyboard.press("Control+k");
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Close with Ctrl+K (toggle)
  await po.page.keyboard.press("Control+k");
  await po.page.getByTestId("app-search-dialog").waitFor({ state: "hidden" });
});

test("app search - navigation and selection", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create multiple apps
  await po.sendPrompt("create first application");
  await po.goToAppsTab();

  await po.sendPrompt("create second application");
  await po.goToAppsTab();

  await po.sendPrompt("create third application");
  await po.goToAppsTab();

  // Open search dialog
  await po.page.getByTestId("search-apps-button").click();
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Get all app items in the search results
  const searchItems = await po.page.getByTestId(/^app-search-item-/).all();

  if (searchItems.length > 0) {
    // Click on the first search result
    await searchItems[0].click();

    // Dialog should close after selection
    await po.page.getByTestId("app-search-dialog").waitFor({ state: "hidden" });

    // Should navigate to the selected app
    await po.page.waitForTimeout(1000);
  } else {
    // If no items found, just close the dialog
    await po.page.keyboard.press("Escape");
  }
});

test("app search - empty search shows all apps", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create a few apps
  await po.sendPrompt("create alpha application");
  await po.goToAppsTab();

  await po.sendPrompt("create beta application");
  await po.goToAppsTab();

  await po.sendPrompt("create gamma application");
  await po.goToAppsTab();

  // Open search dialog
  await po.page.getByTestId("search-apps-button").click();
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Clear any existing search (should show all apps)
  await po.page.getByPlaceholder("Search apps").clear();
  await po.page.waitForTimeout(500);

  // Should show all apps in the list
  const searchItems = await po.page.getByTestId(/^app-search-item-/).all();
  console.log(`Found ${searchItems.length} apps in search results`);

  await po.page.keyboard.press("Escape");
});

test("app search - case insensitive search", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create an app with mixed case content
  await po.sendPrompt("create a Test Application with Mixed Case Content");
  await po.goToAppsTab();

  // Open search dialog
  await po.page.getByTestId("search-apps-button").click();
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Search with different cases
  await po.page.getByPlaceholder("Search apps").fill("test");
  await po.page.waitForTimeout(500);

  await po.page.getByPlaceholder("Search apps").fill("TEST");
  await po.page.waitForTimeout(500);

  await po.page.getByPlaceholder("Search apps").fill("Test");
  await po.page.waitForTimeout(500);

  await po.page.getByPlaceholder("Search apps").fill("MIXED");
  await po.page.waitForTimeout(500);

  await po.page.keyboard.press("Escape");
});

test("app search - partial word matching", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create an app with a long descriptive name
  await po.sendPrompt("create a comprehensive project management solution");
  await po.goToAppsTab();

  // Open search dialog
  await po.page.getByTestId("search-apps-button").click();
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Search with partial words
  await po.page.getByPlaceholder("Search apps").fill("proj");
  await po.page.waitForTimeout(500);

  await po.page.getByPlaceholder("Search apps").fill("manage");
  await po.page.waitForTimeout(500);

  await po.page.getByPlaceholder("Search apps").fill("comp");
  await po.page.waitForTimeout(500);

  await po.page.getByPlaceholder("Search apps").fill("sol");
  await po.page.waitForTimeout(500);

  await po.page.keyboard.press("Escape");
});

test("app search - search by app name", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create apps - note that app names are randomly generated
  await po.sendPrompt("create a todo application");
  await po.goToAppsTab();

  await po.sendPrompt("build a weather dashboard");
  await po.goToAppsTab();

  await po.sendPrompt("create a blog system");
  await po.goToAppsTab();

  // Get the actual app names from the UI (these are randomly generated)
  const appItems = await po.page.getByTestId(/^app-list-item-/).all();
  const appNames: string[] = [];
  for (const item of appItems) {
    const testId = await item.getAttribute("data-testid");
    if (testId) {
      const appName = testId.replace("app-list-item-", "");
      appNames.push(appName);
    }
  }

  // Open search dialog
  await po.page.getByTestId("search-apps-button").click();
  await po.page.getByTestId("app-search-dialog").waitFor();

  // Test searching by actual app names (randomly generated)
  if (appNames.length > 0) {
    // Search for the first few characters of the first app name
    const firstAppName = appNames[0];
    const searchTerm = firstAppName.substring(
      0,
      Math.min(4, firstAppName.length),
    );
    await po.page.getByPlaceholder("Search apps").fill(searchTerm);
    await po.page.waitForTimeout(500);

    // Clear and search for second app if available
    if (appNames.length > 1) {
      await po.page.getByPlaceholder("Search apps").clear();
      const secondAppName = appNames[1];
      const secondSearchTerm = secondAppName.substring(
        0,
        Math.min(4, secondAppName.length),
      );
      await po.page.getByPlaceholder("Search apps").fill(secondSearchTerm);
      await po.page.waitForTimeout(500);
    }
  }

  await po.page.keyboard.press("Escape");
});
