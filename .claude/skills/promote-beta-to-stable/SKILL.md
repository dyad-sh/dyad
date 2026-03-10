---
name: dyad:promote-beta-to-stable
description: Promote the latest pre-release to a stable release by creating a release branch, bumping the version, and pushing.
---

# Promote Beta to Stable

Promote the latest pre-release of dyad-sh/dyad to a stable release.

**IMPORTANT:** This skill MUST complete all steps autonomously. Do NOT ask for user confirmation at any step.

## Instructions

1. **Look up the latest pre-release:**

   ```
   gh release list --repo dyad-sh/dyad --limit 10 --json tagName,isPrerelease
   ```

   Find the most recent release where `isPrerelease` is `true`. Extract the version from the tag name (e.g., `v0.39.0-beta.1`).

   If no pre-release is found, report this and stop.

2. **Get the commit for the pre-release tag:**

   ```
   git fetch upstream --tags
   git rev-parse <tag>
   ```

   Where `<tag>` is the tag name from step 1 (e.g., `v0.39.0-beta.1`).

3. **Determine the release branch name:**

   Parse the version to extract MAJOR and MINOR components. The branch name should be `release-MAJOR.MINOR.x`.

   For example:
   - `v0.39.0-beta.1` → `release-0.39.x`
   - `v1.2.0-beta.3` → `release-1.2.x`

4. **Create the release branch from the pre-release commit:**

   ```
   git checkout -b release-MAJOR.MINOR.x <commit-sha>
   ```

5. **Bump the version in package.json:**

   Read `package.json` and change the `version` field from the pre-release version to the stable version by stripping the pre-release suffix.

   For example:
   - `0.39.0-beta.1` → `0.39.0`
   - `1.2.0-beta.3` → `1.2.0`

   Use the Edit tool to make this change.

6. **Create the commit:**

   Stage and commit the change:

   ```
   git add package.json
   git commit -m "Bump to v<STABLE_VERSION>"
   ```

   For example: `git commit -m "Bump to v0.39.0"`

7. **Push the branch to upstream (dyad-sh/dyad):**

   ```
   git push upstream release-MAJOR.MINOR.x
   ```

8. **Summarize the results:**
   - Report the pre-release that was promoted (e.g., `v0.39.0-beta.1`)
   - Report the stable version (e.g., `v0.39.0`)
   - Report the release branch name (e.g., `release-0.39.x`)
   - Confirm the branch was pushed to upstream
