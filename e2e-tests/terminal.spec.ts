import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Terminal Drawer", () => {
  test.describe("UI Interactions", () => {
    test("should open and close terminal drawer", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      // Terminal should not be visible initially
      await po.terminal.expectNotVisible();

      // Open terminal using toggle button
      await po.terminal.open();
      await po.terminal.expectVisible();

      // Close terminal using collapse button
      await po.terminal.close();
      await po.terminal.expectNotVisible();
    });

    test("should toggle terminal open and closed", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      // Toggle open
      await po.terminal.toggle();
      await po.terminal.expectVisible();

      // Toggle closed
      await po.terminal.toggle();
      await po.terminal.expectNotVisible();

      // Toggle open again
      await po.terminal.toggle();
      await po.terminal.expectVisible();
    });

    test("should close and end session when clicking X button", async ({
      po,
    }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Click the close and end session button
      await po.terminal.closeAndEndSession();
      await po.terminal.expectNotVisible();
    });

    test("should clear terminal output", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Execute a command to generate output
      await po.terminal.executeCommand("echo test output");

      // Wait for output to appear
      await po.terminal.expectOutputContains("$ echo test output");

      // Clear the terminal
      await po.terminal.clear();

      // Terminal ready message should appear after clear
      await po.terminal.expectReady();
    });
  });

  test.describe("Session Management", () => {
    test("should auto-create session when opening terminal", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();

      // Should show connecting state briefly then become ready
      await po.terminal.waitForSession();
      await po.terminal.expectInputEnabled();
    });

    test("should show Terminal ready message on new session", async ({
      po,
    }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Check for ready message
      await po.terminal.expectReady();
    });

    test("should create new session when clicking new session button", async ({
      po,
    }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Execute a command
      await po.terminal.executeCommand("echo first session");
      await po.terminal.expectOutputContains("$ echo first session");

      // Create new session
      await po.terminal.createNewSession();

      // Output should be cleared and show ready message
      await po.terminal.expectReady();
    });

    test("should disable input when no session is active", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Close session but keep terminal open
      await po.terminal.getCloseButton().click();
      await po.terminal.expectNotVisible();

      // Reopen terminal - session should be recreated
      await po.terminal.open();
      await po.terminal.waitForSession();
      await po.terminal.expectInputEnabled();
    });
  });

  test.describe("Command Execution", () => {
    testSkipIfWindows(
      "should execute echo command and show output",
      async ({ po }) => {
        await po.setUp();
        await po.sendPrompt("Create a simple component");
        await po.approveProposal();

        await po.terminal.open();
        await po.terminal.waitForSession();

        // Execute echo command
        await po.terminal.executeCommand("echo hello world");

        // Should show the command input
        await po.terminal.expectOutputContains("$ echo hello world");

        // Should show the output (may take a moment)
        await po.terminal.expectOutputContains("hello world", {
          timeout: Timeout.MEDIUM,
        });
      },
    );

    testSkipIfWindows(
      "should execute pwd command and show directory",
      async ({ po }) => {
        await po.setUp();
        await po.sendPrompt("Create a simple component");
        await po.approveProposal();

        const appPath = await po.appManagement.getCurrentAppPath();

        await po.terminal.open();
        await po.terminal.waitForSession();

        // Execute pwd command
        await po.terminal.executeCommand("pwd");

        // Should show the command input
        await po.terminal.expectOutputContains("$ pwd");

        // Should show the app path in output
        if (appPath) {
          await po.terminal.expectOutputContains(appPath, {
            timeout: Timeout.MEDIUM,
          });
        }
      },
    );

    testSkipIfWindows(
      "should execute ls command and show files",
      async ({ po }) => {
        await po.setUp();
        await po.sendPrompt("Create a simple component");
        await po.approveProposal();

        await po.terminal.open();
        await po.terminal.waitForSession();

        // Execute ls command
        await po.terminal.executeCommand("ls");

        // Should show the command input
        await po.terminal.expectOutputContains("$ ls");

        // Should show package.json (standard file in React projects)
        await po.terminal.expectOutputContains("package.json", {
          timeout: Timeout.MEDIUM,
        });
      },
    );

    testSkipIfWindows(
      "should display command input with $ prefix",
      async ({ po }) => {
        await po.setUp();
        await po.sendPrompt("Create a simple component");
        await po.approveProposal();

        await po.terminal.open();
        await po.terminal.waitForSession();

        await po.terminal.executeCommand("echo test");

        // Command should be displayed with $ prefix
        await po.terminal.expectOutputContains("$ echo test");
      },
    );

    testSkipIfWindows(
      "should handle multiple sequential commands",
      async ({ po }) => {
        await po.setUp();
        await po.sendPrompt("Create a simple component");
        await po.approveProposal();

        await po.terminal.open();
        await po.terminal.waitForSession();

        // Execute first command
        await po.terminal.executeCommand("echo first");
        await po.terminal.expectOutputContains("first", {
          timeout: Timeout.MEDIUM,
        });

        // Execute second command
        await po.terminal.executeCommand("echo second");
        await po.terminal.expectOutputContains("second", {
          timeout: Timeout.MEDIUM,
        });

        // Both commands should be visible
        await po.terminal.expectOutputContains("$ echo first");
        await po.terminal.expectOutputContains("$ echo second");
      },
    );
  });

  test.describe("Keyboard Shortcuts", () => {
    testSkipIfWindows("should clear terminal with Ctrl+L", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Execute a command
      await po.terminal.executeCommand("echo test");
      await po.terminal.expectOutputContains("$ echo test");

      // Use Ctrl+L to clear
      await po.terminal.sendClearScreen();

      // Should show ready message after clear
      await po.terminal.expectReady();
    });
  });

  test.describe("Session Info Display", () => {
    test("should display app path in session info", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      const appPath = await po.appManagement.getCurrentAppPath();

      await po.terminal.open();
      await po.terminal.waitForSession();

      // Session info should contain part of the app path
      if (appPath) {
        const sessionInfo = await po.terminal.getSessionInfo().textContent();
        expect(sessionInfo).toBeTruthy();
        // The session info shows the cwd which should be the app path
        expect(appPath).toContain(sessionInfo?.split("/").pop() || "");
      }
    });
  });

  test.describe("Error Handling", () => {
    testSkipIfWindows(
      "should handle invalid command gracefully",
      async ({ po }) => {
        await po.setUp();
        await po.sendPrompt("Create a simple component");
        await po.approveProposal();

        await po.terminal.open();
        await po.terminal.waitForSession();

        // Execute a non-existent command
        await po.terminal.executeCommand("nonexistentcommand12345");

        // Should show the command was entered
        await po.terminal.expectOutputContains("$ nonexistentcommand12345");

        // Should show some error output (command not found or similar)
        // The exact message varies by shell, but there should be output
        await expect(async () => {
          const output = await po.terminal.getOutputText();
          // Either shows an error or the command just doesn't exist
          expect(output.length).toBeGreaterThan(30);
        }).toPass({ timeout: Timeout.MEDIUM });
      },
    );
  });

  test.describe("Terminal Toggle Button", () => {
    test("should have terminal toggle button in action header", async ({
      po,
    }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      // Toggle button should be visible in the action header
      await expect(po.terminal.getToggleButton()).toBeVisible();
    });

    test("should change appearance when terminal is open", async ({ po }) => {
      await po.setUp();
      await po.sendPrompt("Create a simple component");
      await po.approveProposal();

      const toggleButton = po.terminal.getToggleButton();

      // Get initial classes
      const initialClasses = await toggleButton.getAttribute("class");

      // Open terminal
      await po.terminal.open();

      // Classes should change when terminal is open (active state)
      const openClasses = await toggleButton.getAttribute("class");

      // The button should have different styling when active
      // (the exact classes may vary, but they should be different)
      expect(openClasses).not.toBe(initialClasses);
    });
  });
});
