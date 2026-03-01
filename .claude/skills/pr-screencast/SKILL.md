---
name: coney:pr-screencast
description: Record a visual demonstration of the key feature of this PR using screenshots and add it as a new comment to the PR.
---

# PR Screencast

Record a visual demonstration of the key feature of this PR using screenshots and add it as a new comment to the PR.

**IMPORTANT:** This skill should complete all steps autonomously where possible. Permission prompts from Claude Code for file writes, bash commands, or GitHub operations should be accepted as normal — do not treat them as blockers.

## Arguments

- `$ARGUMENTS`: (Optional) PR number or URL. If not provided, will use the PR associated with the current branch.

## Task Tracking

**You MUST use the TodoWrite tool to track your progress.** At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish. This ensures you complete ALL steps.

## Instructions

1. **Determine the PR:**

   If `$ARGUMENTS` is provided, use it as the PR number or URL.

   Otherwise, get the PR for the current branch:

   ```
   gh pr view --json number,title,body,files,headRefOid -q '.number'
   ```

   If no PR exists for the current branch, report an error and stop.

2. **Analyze if this PR is user-facing:**

   Fetch the PR details including changed files:

   ```
   gh pr view <PR_NUMBER> --json title,body,files,labels
   ```

   **Skip recording if the PR is NOT user-facing.** A PR is NOT user-facing if:
   - It only changes documentation files (`*.md`, `*.txt`, `*.rst`)
   - It only changes configuration files (`*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.config.*`)
   - It only changes test files (`*test*`, `*spec*`, `*tests*`)
   - It only changes CI/CD files (`.github/*`, `.circleci/*`, etc.)
   - It only changes type definitions (\*.d.ts)
   - It has labels like "refactor", "chore", "docs", "ci", "internal", "dependencies"
   - The title/body indicates it's a refactoring, internal change, or non-user-facing work

   If the PR is not user-facing, post a brief comment explaining why the screencast was skipped:

   ```
   gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
   ## Screencast Skipped

   This PR appears to be a non-user-facing change (refactoring, documentation, tests, or internal changes), so no screencast was recorded.

   ---
   *Automated by `/coney:pr-screencast`*
   EOF
   )"
   ```

   Then stop.

3. **Identify the key feature to demonstrate:**

   Analyze the PR to understand:
   - What UI component or feature was added/changed?
   - What user action triggers the feature?
   - What is the expected visual outcome?

   Read the changed files to understand:
   - Which components are affected
   - What user interactions are involved
   - What visual changes should be demonstrated

   Formulate a plan for what the screencast should show:
   - Starting state (screenshot 1)
   - User actions to perform
   - Result state (screenshot 2-3)

4. **Create a Playwright screencast script:**

   Create a new file at `e2e-tests/screencast-demo.spec.ts` that takes multiple screenshots to tell the visual story:

   ```typescript
   import { expect } from "@playwright/test";
   import { test } from "./helpers/fixtures";
   import * as fs from "fs";
   import * as path from "path";

   test.describe.configure({ mode: "serial" });

   test("PR Demo Screencast", async ({ electronApp, po }) => {
     // Ensure screenshots directory exists
     const screenshotDir = path.join(__dirname, "screencast-screenshots");
     if (!fs.existsSync(screenshotDir)) {
       fs.mkdirSync(screenshotDir, { recursive: true });
     }

     const page = await electronApp.firstWindow();

     // Set up the app for demo
     await po.setUp({ autoApprove: true });

     // Import or create a test app if needed
     await po.importApp("minimal");

     // Wait for app to be ready
     await page.waitForTimeout(1000);

     // === STEP 1: Capture initial state ===
     await page.screenshot({
       path: path.join(screenshotDir, "01-initial-state.png"),
       fullPage: false,
     });

     // === STEP 2: Navigate to the feature / perform action ===
     // TODO: Replace with actual navigation/interaction for this PR
     // Example: await po.goToSettingsTab();
     await page.waitForTimeout(500);

     await page.screenshot({
       path: path.join(screenshotDir, "02-during-action.png"),
       fullPage: false,
     });

     // === STEP 3: Show the result ===
     // TODO: Replace with actual result state
     await page.waitForTimeout(500);

     await page.screenshot({
       path: path.join(screenshotDir, "03-final-result.png"),
       fullPage: false,
     });

     // Verify the final screenshot exists to ensure all steps completed
     expect(
       fs.existsSync(path.join(screenshotDir, "03-final-result.png")),
     ).toBe(true);
   });
   ```

   **Customize the script based on the feature being demonstrated:**
   - Use the PageObject methods from `e2e-tests/helpers/page-objects/PageObject.ts`
   - Use stable selectors (data-testid, role, text)
   - Add appropriate waits between actions (500-1000ms) so screenshots are clear
   - Capture 2-4 screenshots showing the progression of the feature

5. **Build the app:**

   The app must be built before recording:

   ```
   npm run build
   ```

6. **Run the screencast test:**

   Run the test to capture screenshots:

   ```
   PLAYWRIGHT_HTML_OPEN=never npx playwright test e2e-tests/screencast-demo.spec.ts --timeout=120000 --reporter=list
   ```

   If the test fails, read the error output, fix the script, and try again (up to 3 attempts). If the test still fails after 3 attempts, post a comment on the PR indicating the screencast could not be captured and report the error. Common issues:
   - Missing selectors - check the component implementation
   - Timing issues - add more `waitForTimeout` calls
   - Import app issues - try a different test app or create from scratch

7. **Verify screenshots were captured:**

   Check that the screenshots exist:

   ```
   ls -la e2e-tests/screencast-screenshots/
   ```

   You should see 2-4 PNG files. If not, check the test output for errors.

8. **Upload screenshots to GitHub:**

   Upload screenshots to an `assets` branch so they can be referenced in PR comments.

   ```bash
   # Get repo info
   REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
   TIMESTAMP=$(date +%Y%m%d-%H%M%S)
   ASSET_DIR="pr-screencasts/pr-<PR_NUMBER>-$TIMESTAMP"

   # Create or update the assets branch
   git fetch origin assets:assets 2>/dev/null || git checkout --orphan assets

   # Switch to assets branch, preserving working directory
   git stash --include-untracked
   git checkout assets 2>/dev/null || (git checkout --orphan assets && git rm -rf . 2>/dev/null || true)

   # Create directory and copy screenshots
   mkdir -p "$ASSET_DIR"
   git stash pop 2>/dev/null || true
   cp e2e-tests/screencast-screenshots/*.png "$ASSET_DIR/"

   # Commit and push
   git add "$ASSET_DIR"
   git commit -m "Add screencast assets for PR #<PR_NUMBER>"
   git push origin assets

   # Switch back to original branch
   git checkout -
   git stash pop 2>/dev/null || true
   ```

   The screenshots will be accessible at:

   ```
   https://raw.githubusercontent.com/<REPO>/assets/<ASSET_DIR>/<filename>.png
   ```

   **Fallback: Use text description if upload fails:**
   If uploads don't work, describe the screenshots in text format.

9. **Post the comment to the PR:**

   Create the PR comment with the demonstration:

   ```
   gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
   ## Feature Demo

   ### What this PR does
   <Brief description of the feature based on your analysis>

   ### Visual Walkthrough

   **Step 1: Initial State**
   <Description of screenshot 1 - or embed image if uploaded>

   **Step 2: User Action**
   <Description of what the user does and screenshot 2>

   **Step 3: Result**
   <Description of the final result and screenshot 3>

   ### How to Test Manually
   1. <Step to reproduce>
   2. <Expected behavior>

   ---
   *Automated by `/coney:pr-screencast`*
   EOF
   )"
   ```

   **IMPORTANT:** Do NOT use `--edit-last` or modify existing comments. Always create a NEW comment.

10. **Clean up the Playwright script and assets:**

    Delete the temporary screencast script and screenshots:

    ```
    rm -f e2e-tests/screencast-demo.spec.ts
    rm -rf e2e-tests/screencast-screenshots/
    ```

    Also clean up any test results:

    ```
    rm -rf test-results/screencast-demo*
    ```

11. **Summarize results:**

    Report to the user:
    - Whether the PR was determined to be user-facing or not
    - What feature was demonstrated (if applicable)
    - How many screenshots were captured
    - Link to the PR comment
    - Any issues encountered during recording
