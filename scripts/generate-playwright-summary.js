// This script parses Playwright JSON results and generates a PR comment summary
// Used by the CI workflow's merge-reports job

const fs = require("fs");

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

  // Initialize per-OS results
  const resultsByOs = {};
  if (hasMacOS)
    resultsByOs["macOS"] = {
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
    };
  if (hasWindows)
    resultsByOs["Windows"] = {
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
    };

  // Traverse suites and collect test results
  function traverseSuites(suites, parentTitle = "") {
    for (const suite of suites || []) {
      const suiteTitle = parentTitle
        ? `${parentTitle} > ${suite.title}`
        : suite.title;

      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          // Determine OS from attachments in results (they contain platform paths)
          for (const result of test.results || []) {
            let os = null;

            // Check attachment paths for OS indicators
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

            // Fallback: check error stack for OS paths
            if (!os && result.error?.stack) {
              if (result.error.stack.includes("/Users/")) os = "macOS";
              else if (
                result.error.stack.includes("C:\\") ||
                result.error.stack.includes("D:\\")
              )
                os = "Windows";
            }

            // If we still don't know, assign to both (will be roughly split)
            const osTargets = os ? [os] : Object.keys(resultsByOs);

            for (const targetOs of osTargets) {
              if (!resultsByOs[targetOs]) continue;
              const status = result.status;

              if (status === "passed") {
                resultsByOs[targetOs].passed++;
              } else if (
                status === "failed" ||
                status === "timedOut" ||
                status === "interrupted"
              ) {
                resultsByOs[targetOs].failed++;
                resultsByOs[targetOs].failures.push({
                  title: `${suiteTitle} > ${spec.title}`,
                  error: result.error?.message?.split("\n")[0] || "Test failed",
                });
              } else if (status === "skipped") {
                resultsByOs[targetOs].skipped++;
              }
            }

            // Only count once per test (first result or last retry)
            break;
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
    totalSkipped = 0;
  for (const os of Object.keys(resultsByOs)) {
    totalPassed += resultsByOs[os].passed;
    totalFailed += resultsByOs[os].failed;
    totalSkipped += resultsByOs[os].skipped;
  }

  // Build the comment
  let comment = "## 🎭 Playwright Test Results\n\n";
  const allPassed = totalFailed === 0;

  if (allPassed) {
    comment += "### ✅ All tests passed!\n\n";
    comment += "| OS | Passed | Skipped |\n";
    comment += "|:---|:---:|:---:|\n";
    for (const [os, data] of Object.entries(resultsByOs)) {
      const emoji = os === "macOS" ? "🍎" : "🪟";
      comment += `| ${emoji} ${os} | ${data.passed} | ${data.skipped} |\n`;
    }
    comment += `\n**Total: ${totalPassed} tests passed**`;
    if (totalSkipped > 0) comment += ` (${totalSkipped} skipped)`;
  } else {
    comment += "### ❌ Some tests failed\n\n";
    comment += "| OS | Passed | Failed | Skipped |\n";
    comment += "|:---|:---:|:---:|:---:|\n";
    for (const [os, data] of Object.entries(resultsByOs)) {
      const emoji = os === "macOS" ? "🍎" : "🪟";
      comment += `| ${emoji} ${os} | ${data.passed} | ${data.failed} | ${data.skipped} |\n`;
    }
    comment += `\n**Summary: ${totalPassed} passed, ${totalFailed} failed**`;
    if (totalSkipped > 0) comment += `, ${totalSkipped} skipped`;

    comment += "\n\n### Failed Tests\n\n";

    for (const [os, data] of Object.entries(resultsByOs)) {
      if (data.failures.length === 0) continue;
      const emoji = os === "macOS" ? "🍎" : "🪟";
      comment += `#### ${emoji} ${os}\n\n`;
      for (const f of data.failures.slice(0, 10)) {
        const errorPreview =
          f.error.length > 150 ? f.error.substring(0, 150) + "..." : f.error;
        comment += `- \`${f.title}\`\n  - ${errorPreview}\n`;
      }
      if (data.failures.length > 10) {
        comment += `- ... and ${data.failures.length - 10} more\n`;
      }
      comment += "\n";
    }
  }

  const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  const runId = process.env.GITHUB_RUN_ID;
  comment += `\n---\n📊 [View full report](${repoUrl}/actions/runs/${runId})`;

  // Post or update comment on PR
  if (context.eventName === "pull_request") {
    const { data: comments } = await github.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
    });

    const botComment = comments.find(
      (c) =>
        c.user?.type === "Bot" &&
        c.body?.includes("🎭 Playwright Test Results"),
    );

    if (botComment) {
      await github.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: botComment.id,
        body: comment,
      });
    } else {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: comment,
      });
    }
  }

  // Always output to job summary
  await core.summary.addRaw(comment).write();
}

module.exports = { run };
