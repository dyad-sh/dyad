// This script parses Playwright JSON results and generates a PR comment summary
// Used by the CI workflow's merge-reports job

const fs = require("fs");

// Expected number of shards per OS
const EXPECTED_SHARDS_PER_OS = 4;

// Strip ANSI escape codes from terminal output
function stripAnsi(str) {
  if (!str) return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u001b\[[0-9;]*m/g, "");
}

function ensureOsBucket(resultsByOs, os) {
  if (!os) return;
  if (!resultsByOs[os]) {
    resultsByOs[os] = {
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
      flakyTests: [],
    };
  }
}

// Check if any shards are missing based on blob report file counts.
// Blob files are named report-${platform}-${timestamp}.zip (e.g., report-darwin-2024-01-01T12-00-00-000Z.zip)
// We can't identify WHICH shards are missing, only that some are missing by counting files per OS.
function detectMissingShards(blobFiles) {
  let macosCount = 0;
  let windowsCount = 0;

  for (const file of blobFiles) {
    // Blob files are named: report-darwin-*.zip or report-win32-*.zip
    if (file.includes("darwin")) {
      macosCount++;
    } else if (file.includes("win32")) {
      windowsCount++;
    }
  }

  const macosMissing = Math.max(0, EXPECTED_SHARDS_PER_OS - macosCount);
  const windowsMissing = Math.max(0, EXPECTED_SHARDS_PER_OS - windowsCount);

  return {
    counts: {
      macos: { found: macosCount, missing: macosMissing },
      windows: { found: windowsCount, missing: windowsMissing },
    },
    hasMissing: macosMissing > 0 || windowsMissing > 0,
  };
}

// Extract spec file and test name from a full test title
// Title format: "spec_name.spec.ts > Test Suite > Test Name"
function parseTestTitle(fullTitle) {
  const parts = fullTitle.split(" > ");
  let specFile = parts[0] || "";
  const testName = parts.slice(1).join(" > ");

  // Ensure the spec file ends with .spec.ts
  if (!specFile.endsWith(".spec.ts")) {
    specFile = specFile + ".spec.ts";
  }

  return { specFile, testName };
}

// Detect if a test failure is due to a snapshot mismatch
function isSnapshotFailure(errorMessage) {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return [
    "screenshot comparison failed",
    "snapshot comparison failed",
    "expected to match snapshot",
    "tomatchsnapshot",
    "tohavescreenshot",
    "screenshots are different",
    "snapshots don't match",
    "snapshot mismatch",
    "snapshot",
    "ratio of different pixels",
  ].some((pattern) => lower.includes(pattern));
}

// Generate copy-paste command for running a specific test
function generateTestCommand(fullTitle) {
  const { specFile, testName } = parseTestTitle(fullTitle);
  // Sanitize specFile to only allow safe path characters
  const safeSpecFile = specFile.replace(/[^a-zA-Z0-9._\-/]/g, "");
  // Escape special characters in testName for the grep pattern
  const escapedTestName = testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `npm run e2e e2e-tests/${safeSpecFile} -- -g "${escapedTestName}"`;
}

function detectOperatingSystemsFromReport(report) {
  const detected = new Set();

  function traverseSuites(suites = []) {
    for (const suite of suites) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            for (const attachment of result.attachments || []) {
              const p = attachment.path || "";
              if (p.includes("darwin") || p.includes("macos")) {
                detected.add("macOS");
              } else if (p.includes("win32") || p.includes("windows")) {
                detected.add("Windows");
              }
            }

            const stack = result.error?.stack || "";
            if (stack.includes("/Users/")) {
              detected.add("macOS");
            } else if (stack.includes("C:\\") || stack.includes("D:\\")) {
              detected.add("Windows");
            }
          }
        }
      }

      if (suite.suites?.length) {
        traverseSuites(suite.suites);
      }
    }
  }

  traverseSuites(report?.suites);

  return detected;
}

function determineIssueNumber({ context }) {
  const envNumber = process.env.PR_NUMBER;
  if (envNumber) return Number(envNumber);

  if (context.eventName === "workflow_run") {
    const prFromPayload =
      context.payload?.workflow_run?.pull_requests?.[0]?.number;
    if (prFromPayload) return prFromPayload;
  } else if (context.eventName === "pull_request") {
    // Direct PR trigger (e.g., from merge-reports job in CI)
    return context.payload?.pull_request?.number || null;
  }
  // For push events (e.g., main branch), there's no PR number
  return null;
}

async function run({ github, context, core }) {
  // Read the JSON report
  const reportPath = "playwright-report/results.json";
  if (!fs.existsSync(reportPath)) {
    console.log("No results.json found, skipping comment");
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

  // Identify which OS each blob report came from
  const blobDir = "all-blob-reports";
  const blobFiles = fs.existsSync(blobDir) ? fs.readdirSync(blobDir) : [];
  const hasMacOS = blobFiles.some((f) => f.includes("darwin"));
  const hasWindows = blobFiles.some((f) => f.includes("win32"));

  // Check for missing shards
  const { counts: shardCounts, hasMissing } = detectMissingShards(blobFiles);

  // Initialize per-OS results
  const resultsByOs = {};
  if (hasMacOS) ensureOsBucket(resultsByOs, "macOS");
  if (hasWindows) ensureOsBucket(resultsByOs, "Windows");

  if (Object.keys(resultsByOs).length === 0) {
    const detected = detectOperatingSystemsFromReport(report);
    if (detected.size === 0) {
      ensureOsBucket(resultsByOs, "macOS");
      ensureOsBucket(resultsByOs, "Windows");
    } else {
      for (const os of detected) ensureOsBucket(resultsByOs, os);
    }
  }

  // Traverse suites and collect test results
  function traverseSuites(suites, parentTitle = "") {
    for (const suite of suites || []) {
      const suiteTitle = parentTitle
        ? `${parentTitle} > ${suite.title}`
        : suite.title;

      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const results = test.results || [];
          if (results.length === 0) continue;

          // Use the final result (last retry attempt) to determine the test outcome
          const finalResult = results[results.length - 1];

          // Determine OS from attachments in any result (they contain platform paths)
          let os = null;
          for (const result of results) {
            for (const att of result.attachments || []) {
              const p = att.path || "";
              if (p.includes("darwin") || p.includes("macos")) {
                os = "macOS";
                break;
              }
              if (p.includes("win32") || p.includes("windows")) {
                os = "Windows";
                break;
              }
            }
            if (os) break;

            // Fallback: check error stack for OS paths
            if (result.error?.stack) {
              if (result.error.stack.includes("/Users/")) {
                os = "macOS";
                break;
              } else if (
                result.error.stack.includes("C:\\") ||
                result.error.stack.includes("D:\\")
              ) {
                os = "Windows";
                break;
              }
            }
          }

          // If we still don't know, assign to both (will be roughly split)
          const osTargets = os
            ? [os]
            : Object.keys(resultsByOs).length > 0
              ? Object.keys(resultsByOs)
              : ["macOS", "Windows"];

          // Check if this is a flaky test (passed eventually but had prior failures)
          const hadPriorFailure = results
            .slice(0, -1)
            .some(
              (r) =>
                r.status === "failed" ||
                r.status === "timedOut" ||
                r.status === "interrupted",
            );
          const isFlaky = finalResult.status === "passed" && hadPriorFailure;

          for (const targetOs of osTargets) {
            ensureOsBucket(resultsByOs, targetOs);
            const status = finalResult.status;

            if (isFlaky) {
              resultsByOs[targetOs].flaky++;
              resultsByOs[targetOs].passed++;
              resultsByOs[targetOs].flakyTests.push({
                title: `${suiteTitle} > ${spec.title}`,
                retries: results.length - 1,
              });
            } else if (status === "passed") {
              resultsByOs[targetOs].passed++;
            } else if (
              status === "failed" ||
              status === "timedOut" ||
              status === "interrupted"
            ) {
              resultsByOs[targetOs].failed++;
              const errorMsg =
                finalResult.error?.message?.split("\n")[0] || "Test failed";
              resultsByOs[targetOs].failures.push({
                title: `${suiteTitle} > ${spec.title}`,
                error: stripAnsi(errorMsg),
              });
            } else if (status === "skipped") {
              resultsByOs[targetOs].skipped++;
            }
          }
        }
      }

      // Recurse into nested suites
      if (suite.suites) {
        traverseSuites(suite.suites, suiteTitle);
      }
    }
  }

  traverseSuites(report.suites);

  // Calculate totals
  let totalPassed = 0,
    totalFailed = 0,
    totalSkipped = 0,
    totalFlaky = 0;
  for (const os of Object.keys(resultsByOs)) {
    totalPassed += resultsByOs[os].passed;
    totalFailed += resultsByOs[os].failed;
    totalSkipped += resultsByOs[os].skipped;
    totalFlaky += resultsByOs[os].flaky;
  }

  // Build the comment
  let comment = "## 🎭 Playwright Test Results\n\n";

  // Show warning for missing shards
  if (hasMissing) {
    comment += "### ⚠️ WARNING: Missing Test Shards!\n\n";
    comment +=
      "Some test shards did not report results. This may indicate CI failures or timeouts.\n\n";
    if (shardCounts.macos.missing > 0) {
      comment += `- 🍎 **macOS**: found ${shardCounts.macos.found}/${EXPECTED_SHARDS_PER_OS} shards (${shardCounts.macos.missing} missing)\n`;
    }
    if (shardCounts.windows.missing > 0) {
      comment += `- 🪟 **Windows**: found ${shardCounts.windows.found}/${EXPECTED_SHARDS_PER_OS} shards (${shardCounts.windows.missing} missing)\n`;
    }
    comment += "\n";
  }

  const allPassed = totalFailed === 0;

  if (allPassed) {
    comment += "### ✅ All tests passed!\n\n";
    comment += "| OS | Passed | Flaky | Skipped |\n";
    comment += "|:---|:---:|:---:|:---:|\n";
    for (const [os, data] of Object.entries(resultsByOs)) {
      const emoji = os === "macOS" ? "🍎" : "🪟";
      comment += `| ${emoji} ${os} | ${data.passed} | ${data.flaky} | ${data.skipped} |\n`;
    }
    comment += `\n**Total: ${totalPassed} tests passed**`;
    if (totalFlaky > 0) comment += ` (${totalFlaky} flaky)`;
    if (totalSkipped > 0) comment += ` (${totalSkipped} skipped)`;

    // List flaky tests even when all passed
    if (totalFlaky > 0) {
      comment += "\n\n### ⚠️ Flaky Tests\n\n";
      for (const [os, data] of Object.entries(resultsByOs)) {
        if (data.flakyTests.length === 0) continue;
        const emoji = os === "macOS" ? "🍎" : "🪟";
        comment += `#### ${emoji} ${os}\n\n`;
        for (const f of data.flakyTests.slice(0, 10)) {
          comment += `- \`${f.title}\` (passed after ${f.retries} ${f.retries === 1 ? "retry" : "retries"})\n`;
        }
        if (data.flakyTests.length > 10) {
          comment += `- ... and ${data.flakyTests.length - 10} more\n`;
        }
        comment += "\n";
      }
    }
  } else {
    comment += "### ❌ Some tests failed\n\n";
    comment += "| OS | Passed | Failed | Flaky | Skipped |\n";
    comment += "|:---|:---:|:---:|:---:|:---:|\n";
    for (const [os, data] of Object.entries(resultsByOs)) {
      const emoji = os === "macOS" ? "🍎" : "🪟";
      comment += `| ${emoji} ${os} | ${data.passed} | ${data.failed} | ${data.flaky} | ${data.skipped} |\n`;
    }
    comment += `\n**Summary: ${totalPassed} passed, ${totalFailed} failed**`;
    if (totalFlaky > 0) comment += `, ${totalFlaky} flaky`;
    if (totalSkipped > 0) comment += `, ${totalSkipped} skipped`;

    comment += "\n\n### Failed Tests\n\n";

    for (const [os, data] of Object.entries(resultsByOs)) {
      if (data.failures.length === 0) continue;
      const emoji = os === "macOS" ? "🍎" : "🪟";
      comment += `#### ${emoji} ${os}\n\n`;

      // If more than 10 failures, use collapsible accordion
      if (data.failures.length > 10) {
        comment += `<details>\n<summary>Show all ${data.failures.length} failures</summary>\n\n`;
      }

      for (const f of data.failures) {
        const errorPreview =
          f.error.length > 150 ? f.error.substring(0, 150) + "..." : f.error;
        comment += `- \`${f.title}\`\n  - ${errorPreview}\n`;
      }

      if (data.failures.length > 10) {
        comment += "\n</details>\n";
      }
      comment += "\n";
    }

    // Add macOS copy-paste commands section
    const macOsFailures = resultsByOs["macOS"]?.failures || [];
    if (macOsFailures.length > 0) {
      comment += "### 📋 Test Commands (macOS)\n\n";
      comment += "Copy and paste to re-run failing tests locally:\n\n";

      if (macOsFailures.length > 5) {
        comment += `<details>\n<summary>Show all ${macOsFailures.length} test commands</summary>\n\n`;
      }

      comment += "```bash\n";
      comment += "export PLAYWRIGHT_HTML_OPEN=never\n";
      for (const f of macOsFailures) {
        const cmd = generateTestCommand(f.title);
        const snapshot = isSnapshotFailure(f.error);
        const errorPreview =
          f.error.length > 120 ? f.error.substring(0, 120) + "..." : f.error;
        comment += `\n# ${f.title.replace(/\n/g, " ").replace(/`/g, "'")}\n`;
        comment += `# Expected: ${errorPreview.replace(/\n/g, " ").replace(/`/g, "'")}\n`;
        if (snapshot) {
          comment += `${cmd} --update-snapshots\n`;
        } else {
          comment += `${cmd}\n`;
        }
      }
      comment += "```\n\n";

      if (macOsFailures.length > 5) {
        comment += "</details>\n";
      }
      comment += "\n";
    }

    // List flaky tests
    if (totalFlaky > 0) {
      comment += "### ⚠️ Flaky Tests\n\n";
      for (const [os, data] of Object.entries(resultsByOs)) {
        if (data.flakyTests.length === 0) continue;
        const emoji = os === "macOS" ? "🍎" : "🪟";
        comment += `#### ${emoji} ${os}\n\n`;
        for (const f of data.flakyTests.slice(0, 10)) {
          comment += `- \`${f.title}\` (passed after ${f.retries} ${f.retries === 1 ? "retry" : "retries"})\n`;
        }
        if (data.flakyTests.length > 10) {
          comment += `- ... and ${data.flakyTests.length - 10} more\n`;
        }
        comment += "\n";
      }
    }
  }

  const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  const runId = process.env.PLAYWRIGHT_RUN_ID || process.env.GITHUB_RUN_ID;
  comment += `\n---\n📊 [View full report](${repoUrl}/actions/runs/${runId})`;

  // Post or update comment on PR
  const prNumber = determineIssueNumber({ context });

  if (prNumber) {
    try {
      const { data: comments } = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
      });

      const botComment = comments.find(
        (c) =>
          c.user?.type === "Bot" &&
          c.body?.includes("🎭 Playwright Test Results"),
      );

      if (botComment) {
        await github.rest.issues.deleteComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: botComment.id,
        });
      }

      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: comment,
      });
    } catch (error) {
      // Handle permission errors gracefully (common for fork PRs)
      if (error.status === 403) {
        console.log(
          "Unable to post PR comment due to insufficient permissions (this is expected for fork PRs). " +
            "Results are still available in the job summary.",
        );
      } else {
        throw error;
      }
    }
  } else {
    console.log("No pull request detected; skipping PR comment");
  }

  // Always output to job summary
  await core.summary.addRaw(comment).write();
}

module.exports = { run };
