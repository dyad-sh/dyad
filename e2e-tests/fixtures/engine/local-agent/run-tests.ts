import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write two specs, then run them in one run_tests batch",
  turns: [
    {
      text: "I'll write an end-to-end test for the home page.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "e2e-tests/home.spec.ts",
            content:
              'import { test, expect } from "@playwright/test";\n\ntest("home page loads", async ({ page }) => {\n  await page.goto("/");\n  await expect(page.getByRole("heading")).toBeVisible();\n});\n',
          },
        },
      ],
    },
    {
      text: "I'll also cover navigation.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "e2e-tests/navigation.spec.ts",
            content:
              'import { test, expect } from "@playwright/test";\n\ntest("navigation is visible", async ({ page }) => {\n  await page.goto("/");\n  await expect(page.getByRole("navigation")).toBeVisible();\n});\n',
          },
        },
      ],
    },
    {
      text: "Now let me run the test to verify it works.",
      toolCalls: [
        {
          name: "run_tests",
          args: {
            testFiles: ["e2e-tests/home.spec.ts", "e2e-tests/navigation.spec.ts"],
          },
        },
      ],
      textAfterTools:
        "The app isn't running, so I couldn't execute the test yet.",
    },
  ],
};
