#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Configuration for retry logic
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 30000; // 30 seconds between retries
const INITIAL_DELAY_MS = 60000; // 1 minute initial wait for uploads to complete

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verifies that all expected binary assets are present in the GitHub release
 * for the version specified in package.json.
 *
 * Includes retry logic to handle async asset uploads that may complete
 * after the release is created.
 */
async function verifyReleaseAssets() {
  try {
    // Read version from package.json
    const packagePath = path.join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const version = packageJson.version;

    console.log(`🔍 Verifying release assets for version ${version}...`);
    console.log(
      `⏳ Waiting ${INITIAL_DELAY_MS / 1000}s for all platform builds to upload...`,
    );
    await sleep(INITIAL_DELAY_MS);

    // GitHub API configuration
    const owner = "yosiwizman";
    const repo = "dyad";
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    // Fetch all releases (including drafts)
    const tagName = `v${version}`;

    console.log(`📡 Fetching all releases to find: ${tagName}`);

    const allReleasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
    const response = await fetch(allReleasesUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "abba-ai-release-verifier",
      },
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const allReleases = await response.json();
    const release = allReleases.find((r) => r.tag_name === tagName);

    if (!release) {
      throw new Error(
        `Release ${tagName} not found in published releases or drafts. Make sure the release exists.`,
      );
    }

    const assets = release.assets || [];

    console.log(`📦 Found ${assets.length} assets in release ${tagName}`);
    console.log(`📄 Release status: ${release.draft ? "DRAFT" : "PUBLISHED"}`);

    // Handle beta naming conventions (NuGet removes the dot)
    const normalizeVersionForNupkg = (version) => {
      if (!version.includes("beta")) {
        return version;
      }
      // NuGet removes the dot: 0.14.0-beta.1 -> 0.14.0-beta1
      return version.replace("-beta.", "-beta");
    };

    const windowsSetupBaseName = packageJson.productName.replace(/ /g, ".");
    const nupkgBaseName = packageJson.name.replace(/-/g, "_");

    // Define expected assets for Windows + macOS (Linux deferred)
    // NOTE: Some maker toolchains normalize names (e.g. spaces -> '.' on macOS/Windows).
    const expectedAssets = [
      `${nupkgBaseName}-${normalizeVersionForNupkg(version)}-full.nupkg`,
      `${windowsSetupBaseName}-${version}.Setup.exe`,
      `${windowsSetupBaseName}-darwin-arm64-${version}.zip`,
      `${windowsSetupBaseName}-darwin-x64-${version}.zip`,
      "RELEASES",
    ];

    console.log("📋 Expected assets:");
    expectedAssets.forEach((asset) => console.log(`  - ${asset}`));
    console.log("");

    // Get actual asset names
    const actualAssets = assets.map((asset) => asset.name);

    console.log("📋 Actual assets:");
    actualAssets.forEach((asset) => console.log(`  - ${asset}`));
    console.log("");

    // Check for missing assets with retry logic
    let missingAssets = expectedAssets.filter(
      (expected) => !actualAssets.includes(expected),
    );

    let retryCount = 0;
    while (missingAssets.length > 0 && retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(
        `\n⏳ Missing ${missingAssets.length} asset(s), retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${retryCount}/${MAX_RETRIES})...`,
      );
      missingAssets.forEach((asset) => console.log(`  - ${asset}`));
      await sleep(RETRY_DELAY_MS);

      // Re-fetch release to check for newly uploaded assets
      const retryResponse = await fetch(allReleasesUrl, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "abba-ai-release-verifier",
        },
      });

      if (!retryResponse.ok) {
        console.error(
          `GitHub API error on retry: ${retryResponse.status} ${retryResponse.statusText}`,
        );
        continue;
      }

      const retryReleases = await retryResponse.json();
      const retryRelease = retryReleases.find((r) => r.tag_name === tagName);

      if (retryRelease) {
        const retryAssets = (retryRelease.assets || []).map((a) => a.name);
        console.log(`📦 Found ${retryAssets.length} assets on retry`);
        missingAssets = expectedAssets.filter(
          (expected) => !retryAssets.includes(expected),
        );
      }
    }

    if (missingAssets.length > 0) {
      console.error("\n❌ VERIFICATION FAILED after all retries!");
      console.error("📭 Missing assets:");
      missingAssets.forEach((asset) => console.error(`  - ${asset}`));
      console.error("");
      console.error(
        "Please ensure all platforms have completed their builds and uploads.",
      );
      console.error(
        `Total wait time: ${(INITIAL_DELAY_MS + MAX_RETRIES * RETRY_DELAY_MS) / 1000}s`,
      );
      process.exit(1);
    }

    // Check for unexpected assets (optional warning)
    const unexpectedAssets = actualAssets.filter(
      (actual) => !expectedAssets.includes(actual),
    );

    if (unexpectedAssets.length > 0) {
      console.warn("⚠️  Unexpected assets found:");
      unexpectedAssets.forEach((asset) => console.warn(`  - ${asset}`));
      console.warn("");
    }

    console.log("✅ VERIFICATION PASSED!");
    console.log(
      `🎉 All ${expectedAssets.length} expected assets are present in release ${tagName}`,
    );
    console.log("");
    console.log("📊 Release Summary:");
    console.log(`  Release: ${release.name || tagName}`);
    console.log(`  Tag: ${release.tag_name}`);
    console.log(`  Published: ${release.published_at}`);
    console.log(`  URL: ${release.html_url}`);
  } catch (error) {
    console.error("❌ Error verifying release assets:", error.message);
    process.exit(1);
  }
}

// Run the verification
verifyReleaseAssets();
