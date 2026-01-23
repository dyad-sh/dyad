import { getGitAuthor } from "./git_author";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import {
  exec,
  type IGitStringExecutionOptions,
  type IGitStringResult,
} from "dugite";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import pathModule from "node:path";
import { platform } from "node:os";
import { readSettings } from "../../main/settings";
import log from "electron-log";
import { normalizePath } from "../../../shared/normalizePath";
import type { UncommittedFile, UncommittedFileStatus } from "@/ipc/types";
const logger = log.scope("git_utils");

/**
 * Returns a sanitized environment for git commands on Windows.
 * Filters out WSL-related PATH entries that can cause WSL interop issues.
 * On non-Windows platforms, returns undefined (use default environment).
 *
 * Issue: https://github.com/dyad-sh/dyad/issues/2194
 * When WSL is installed on Windows, the PATH can contain entries that cause
 * git commands to be intercepted by WSL's relay system, resulting in errors
 * like "execvpe(/bin/bash) failed: No such file or directory".
 */
function getWindowsSanitizedEnv():
  | Record<string, string | undefined>
  | undefined {
  if (platform() !== "win32") {
    return undefined;
  }

  // On Windows, the PATH environment variable can be stored with different casings
  // (e.g., "PATH", "Path", "path"). We need to find the actual key used to avoid
  // creating duplicate entries with different casings.
  const pathKey =
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  const currentPath = process.env[pathKey] ?? "";
  const pathSeparator = ";";

  // Filter out PATH entries that could trigger WSL interop
  const sanitizedPathEntries = currentPath
    .split(pathSeparator)
    .filter((entry) => {
      const lowerEntry = entry.toLowerCase();
      // Filter out WSL-related paths:
      // - \\wsl$\ or \\wsl.localhost\ network paths
      // - Paths containing 'windowsapps' that might have WSL shims
      // - Linux-style paths that somehow got into Windows PATH
      if (
        lowerEntry.includes("\\wsl$\\") ||
        lowerEntry.includes("\\wsl.localhost\\") ||
        lowerEntry.includes("windowsapps") ||
        lowerEntry.startsWith("/mnt/") ||
        lowerEntry.startsWith("/usr/") ||
        lowerEntry.startsWith("/bin/") ||
        lowerEntry.startsWith("/home/")
      ) {
        logger.debug(`Filtering WSL-related PATH entry: ${entry}`);
        return false;
      }
      return true;
    });

  return {
    ...process.env,
    [pathKey]: sanitizedPathEntries.join(pathSeparator),
  };
}

/**
 * Wrapper around dugite's exec that uses a sanitized environment on Windows
 * to prevent WSL interop issues.
 */
async function execGit(
  args: string[],
  path: string,
  options?: IGitStringExecutionOptions,
): Promise<IGitStringResult> {
  const sanitizedEnv = getWindowsSanitizedEnv();

  // Only create execOptions if we need to modify the environment
  // On Windows: merge sanitized env with any caller-provided env, ensuring sanitized PATH takes precedence
  // On non-Windows: pass through options unchanged (dugite will use process.env by default)
  if (sanitizedEnv) {
    // Find the PATH key used in the sanitized env
    const pathKey =
      Object.keys(sanitizedEnv).find((key) => key.toUpperCase() === "PATH") ??
      "PATH";
    const execOptions: IGitStringExecutionOptions = {
      ...options,
      env: {
        ...sanitizedEnv,
        ...options?.env,
        // Ensure sanitized PATH always takes precedence to prevent WSL contamination
        [pathKey]: sanitizedEnv[pathKey],
      },
    };
    return exec(args, path, execOptions);
  }

  // On non-Windows, pass options through unchanged
  return exec(args, path, options);
}
import type {
  GitBaseParams,
  GitFileParams,
  GitCheckoutParams,
  GitBranchRenameParams,
  GitCloneParams,
  GitCommitParams,
  GitLogParams,
  GitFileAtCommitParams,
  GitSetRemoteUrlParams,
  GitStageToRevertParams,
  GitInitParams,
  GitPushParams,
  GitCommit,
  GitFetchParams,
  GitPullParams,
  GitMergeParams,
  GitCreateBranchParams,
  GitDeleteBranchParams,
} from "../git_types";

/**
 * Helper function that wraps exec and throws an error if the exit code is non-zero
 */
async function execOrThrow(
  args: string[],
  path: string,
  errorMessage?: string,
): Promise<void> {
  const result = await execGit(args, path);
  if (result.exitCode !== 0) {
    const errorDetails = result.stderr.trim() || result.stdout.trim();
    const error = errorMessage
      ? `${errorMessage}. ${errorDetails}`
      : `Git command failed: ${args.join(" ")}. ${errorDetails}`;
    throw new Error(error);
  }
}

/**
 * Prepends git config args for user.name and user.email to the provided args.
 * Automatically fetches the git author from settings.
 * Usage: await withGitAuthor(["commit", "-m", "message"])
 * Returns: ["-c", "user.name=...", "-c", "user.email=...", "commit", "-m", "message"]
 *
 * Do NOT do "--author" because this does not set the committer identity.
 *
 * Doing -c user.name/email sets both the committer and author identity.
 */
export async function withGitAuthor(args: string[]): Promise<string[]> {
  const author = await getGitAuthor();
  return [
    "-c",
    `user.name=${author.name}`,
    "-c",
    `user.email=${author.email}`,
    ...args,
  ];
}

/**
 * Adds a directory to git's global safe.directory list.
 * This is required on Windows when git operations are performed on directories
 * owned by different users.
 * Only works for native git.
 */
export async function gitAddSafeDirectory(directory: string): Promise<void> {
  // Normalize path to use forward slashes (important for Windows compatibility with git)
  directory = normalizePath(directory);

  try {
    // First check if the directory is already in the safe.directory list
    const checkResult = await execGit(
      ["config", "--global", "--get-all", "safe.directory"],
      ".",
    );

    // Parse existing safe directories (one per line), normalizing for comparison
    const existingSafeDirectories = checkResult.stdout
      .split("\n")
      .map((line) => normalizePath(line.trim()))
      .filter((line) => line.length > 0);

    // Check if already present (exact match after normalization)
    if (existingSafeDirectories.includes(directory)) {
      logger.debug(`Safe directory already exists: ${directory}`);
      return;
    }

    const result = await execGit(
      ["config", "--global", "--add", "safe.directory", directory],
      ".",
    );
    if (result.exitCode !== 0) {
      logger.warn(
        `Failed to add safe directory '${directory}': ${result.stderr.trim() || result.stdout.trim()}`,
      );
    } else {
      logger.info(`Added safe directory: ${directory}`);
    }
  } catch (error: any) {
    logger.warn(
      `Failed to add safe directory '${directory}': ${error.message}`,
    );
  }
}

export async function getCurrentCommitHash({
  path,
  ref = "HEAD",
}: GitInitParams): Promise<string> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    const result = await execGit(["rev-parse", ref], path);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to resolve ref '${ref}': ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout.trim();
  } else {
    return await git.resolveRef({
      fs,
      dir: path,
      ref,
    });
  }
}

export async function isGitStatusClean({
  path,
}: {
  path: string;
}): Promise<boolean> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    const result = await execGit(["status", "--porcelain"], path);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to get status: ${result.stderr}`);
    }

    // If output is empty, working directory is clean (no changes)
    const isClean = result.stdout.trim().length === 0;
    return isClean;
  } else {
    const statusMatrix = await git.statusMatrix({ fs, dir: path });
    return statusMatrix.every(
      (row) => row[1] === 1 && row[2] === 1 && row[3] === 1,
    );
  }
}

export async function gitCommit({
  path,
  message,
  amend,
}: GitCommitParams): Promise<string> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Perform the commit using dugite with -c user.name/email config
    const commitArgs = ["commit", "-m", message];
    if (amend) {
      commitArgs.push("--amend");
    }
    const args = await withGitAuthor(commitArgs);
    await execOrThrow(args, path, "Failed to create commit");
    // Get the new commit hash
    const result = await execGit(["rev-parse", "HEAD"], path);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get commit hash: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout.trim();
  } else {
    return git.commit({
      fs: fs,
      dir: path,
      message,
      author: await getGitAuthor(),
      amend: amend,
    });
  }
}

export async function gitCheckout({
  path,
  ref,
}: GitCheckoutParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(
      ["checkout", ref],
      path,
      `Failed to checkout ref '${ref}'`,
    );
    return;
  } else {
    return git.checkout({ fs, dir: path, ref });
  }
}

export async function gitStageToRevert({
  path,
  targetOid,
}: GitStageToRevertParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Get the current HEAD commit hash
    const currentHeadResult = await execGit(["rev-parse", "HEAD"], path);
    if (currentHeadResult.exitCode !== 0) {
      throw new Error(
        `Failed to get current commit: ${currentHeadResult.stderr.trim() || currentHeadResult.stdout.trim()}`,
      );
    }

    const currentCommit = currentHeadResult.stdout.trim();

    // If we're already at the target commit, nothing to do
    if (currentCommit === targetOid) {
      return;
    }

    // Safety: refuse to run if the work-tree isn't clean.
    const statusResult = await execGit(["status", "--porcelain"], path);
    if (statusResult.exitCode !== 0) {
      throw new Error(
        `Failed to get status: ${statusResult.stderr.trim() || statusResult.stdout.trim()}`,
      );
    }
    if (statusResult.stdout.trim() !== "") {
      throw new Error("Cannot revert: working tree has uncommitted changes.");
    }

    // Reset the working directory and index to match the target commit state
    // This effectively undoes all changes since the target commit
    await execOrThrow(
      ["reset", "--hard", targetOid],
      path,
      `Failed to reset to target commit '${targetOid}'`,
    );

    // Reset back to the original HEAD but keep the working directory as it is
    // This stages all the changes needed to revert to the target state
    await execOrThrow(
      ["reset", "--soft", currentCommit],
      path,
      "Failed to reset back to original HEAD",
    );
  } else {
    // Get status matrix comparing the target commit (previousVersionId as HEAD) with current working directory
    const matrix = await git.statusMatrix({
      fs,
      dir: path,
      ref: targetOid,
    });

    // Process each file to revert to the state in previousVersionId
    for (const [filepath, headStatus, workdirStatus] of matrix) {
      const fullPath = pathModule.join(path, filepath);

      // If file exists in HEAD (previous version)
      if (headStatus === 1) {
        // If file doesn't exist or has changed in working directory, restore it from the target commit
        if (workdirStatus !== 1) {
          const { blob } = await git.readBlob({
            fs,
            dir: path,
            oid: targetOid,
            filepath,
          });
          await fsPromises.mkdir(pathModule.dirname(fullPath), {
            recursive: true,
          });
          await fsPromises.writeFile(fullPath, Buffer.from(blob));
        }
      }
      // If file doesn't exist in HEAD but exists in working directory, delete it
      else if (headStatus === 0 && workdirStatus !== 0) {
        if (fs.existsSync(fullPath)) {
          await fsPromises.unlink(fullPath);
          await git.remove({
            fs,
            dir: path,
            filepath: filepath,
          });
        }
      }
    }

    // Stage all changes
    await git.add({
      fs,
      dir: path,
      filepath: ".",
    });
  }
}

export async function gitAddAll({ path }: GitBaseParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(["add", "."], path, "Failed to stage all files");
    return;
  } else {
    return git.add({ fs, dir: path, filepath: "." });
  }
}

export async function gitAdd({ path, filepath }: GitFileParams): Promise<void> {
  const normalizedFilepath = normalizePath(filepath);
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(
      ["add", "--", normalizedFilepath],
      path,
      `Failed to stage file '${normalizedFilepath}'`,
    );
  } else {
    await git.add({
      fs,
      dir: path,
      filepath: normalizedFilepath,
    });
  }
}

export async function gitReset({ path }: GitBaseParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Reset the staging area to match HEAD (unstage files but keep working directory changes)
    await execOrThrow(["reset", "HEAD"], path, "Failed to reset staging area");
  } else {
    // For isomorphic-git, resetting the index is complex and not directly supported
    // This is a fallback - in practice, this should rarely be needed when native git is disabled
    // If needed, users can manually reset via command line or enable native git
    throw new Error(
      "gitReset: Resetting the staging area is not fully supported when native git is disabled. " +
        "Please enable native git or manually unstage files using 'git reset HEAD'.",
    );
  }
}

export async function gitInit({
  path,
  ref = "main",
}: GitInitParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(
      ["init", "-b", ref],
      path,
      `Failed to initialize git repository with branch '${ref}'`,
    );
  } else {
    await git.init({
      fs,
      dir: path,
      defaultBranch: ref,
    });
  }
}

export async function gitRemove({
  path,
  filepath,
}: GitFileParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(
      ["rm", "-f", "--", filepath],
      path,
      `Failed to remove file '${filepath}'`,
    );
  } else {
    await git.remove({
      fs,
      dir: path,
      filepath,
    });
  }
}

export async function getGitUncommittedFiles({
  path,
}: GitBaseParams): Promise<string[]> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    const result = await execGit(["status", "--porcelain"], path);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get uncommitted files: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout
      .toString()
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => line.slice(3).trim());
  } else {
    const statusMatrix = await git.statusMatrix({ fs, dir: path });
    return statusMatrix
      .filter((row) => row[1] !== 1 || row[2] !== 1 || row[3] !== 1)
      .map((row) => row[0]);
  }
}

/**
 * Get uncommitted files with their status (added, modified, deleted, renamed).
 * This parses git status --porcelain output to determine the file status.
 */
export async function getGitUncommittedFilesWithStatus({
  path,
}: GitBaseParams): Promise<UncommittedFile[]> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    const result = await execGit(["status", "--porcelain"], path);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get uncommitted files: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout
      .toString()
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        // Git status --porcelain format: XY filename
        // X = staged status, Y = unstaged status
        // Common codes: M=modified, A=added, D=deleted, R=renamed, ??=untracked
        const statusCode = line.substring(0, 2);
        let filePath = line.slice(3).trim();

        // Handle renamed files: R  old -> new
        if (statusCode.startsWith("R")) {
          const arrowIndex = filePath.indexOf(" -> ");
          if (arrowIndex !== -1) {
            filePath = filePath.substring(arrowIndex + 4);
          }
          return { path: filePath, status: "renamed" as UncommittedFileStatus };
        }

        // Determine status based on status codes
        // Check deleted first: for status code "AD" (added to index, then deleted
        // from working directory), the file no longer exists so report as deleted
        let status: UncommittedFileStatus;
        if (statusCode.includes("D")) {
          status = "deleted";
        } else if (statusCode === "??" || statusCode.includes("A")) {
          status = "added";
        } else {
          status = "modified";
        }

        return { path: filePath, status };
      });
  } else {
    // For isomorphic-git, we use the status matrix
    // [filepath, HEAD, WORKDIR, STAGE]
    // HEAD: 0=absent, 1=present
    // WORKDIR: 0=absent, 1=identical to HEAD, 2=modified
    // STAGE: 0=absent, 1=identical to HEAD, 2=added, 3=modified
    const statusMatrix = await git.statusMatrix({ fs, dir: path });
    return statusMatrix
      .filter((row) => row[1] !== 1 || row[2] !== 1 || row[3] !== 1)
      .map((row) => {
        const filePath = row[0];
        const head = row[1];
        const workdir = row[2];

        // Check workdir === 0 first: for a file added to index then deleted from
        // working directory, the file no longer exists so report as deleted
        let status: UncommittedFileStatus;
        if (workdir === 0) {
          // File deleted from workdir
          status = "deleted";
        } else if (head === 0) {
          // File not in HEAD = new file
          status = "added";
        } else {
          status = "modified";
        }

        return { path: filePath, status };
      });
  }
}

export async function getFileAtCommit({
  path,
  filePath,
  commitHash,
}: GitFileAtCommitParams): Promise<string | null> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    try {
      const result = await execGit(["show", `${commitHash}:${filePath}`], path);
      if (result.exitCode !== 0) {
        // File doesn't exist at this commit or other error
        return null;
      }
      return result.stdout;
    } catch (error: any) {
      logger.error(
        `Error getting file at commit ${commitHash}: ${error.message}`,
      );
      // File doesn't exist at this commit
      return null;
    }
  } else {
    try {
      const { blob } = await git.readBlob({
        fs,
        dir: path,
        oid: commitHash,
        filepath: filePath,
      });
      return Buffer.from(blob).toString("utf-8");
    } catch (error: any) {
      logger.error(
        `Error getting file at commit ${commitHash}: ${error.message}`,
      );
      // File doesn't exist at this commit
      return null;
    }
  }
}

export async function gitListBranches({
  path,
}: GitBaseParams): Promise<string[]> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    const result = await execGit(["branch", "--list"], path);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
    // Parse output:
    // e.g. "* main\n  feature/login"
    return result.stdout
      .toString()
      .split("\n")
      .map((line) => line.replace("*", "").trim())
      .filter((line) => line.length > 0);
  } else {
    return await git.listBranches({
      fs,
      dir: path,
    });
  }
}

export async function gitListRemoteBranches({
  path,
  remote = "origin",
}: GitBaseParams & { remote?: string }): Promise<string[]> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    const result = await execGit(["branch", "-r", "--list"], path);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
    // Parse output:
    // e.g. "  origin/main\n  origin/feature/login\n  upstream/develop"
    // Only return branches from the specified remote
    return result.stdout
      .toString()
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith(`${remote}/`)) {
          return trimmed.substring(`${remote}/`.length);
        }
        return null;
      })
      .filter(
        (line): line is string =>
          line !== null && line.length > 0 && !line.includes("HEAD"),
      );
  } else {
    const allBranches = await git.listBranches({
      fs,
      dir: path,
      remote: remote,
    });
    return allBranches;
  }
}

export async function gitRenameBranch({
  path,
  oldBranch,
  newBranch,
}: GitBranchRenameParams): Promise<void> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    // git branch -m oldBranch newBranch
    const result = await execGit(["branch", "-m", oldBranch, newBranch], path);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
  } else {
    // isomorphic-git does not have a renameBranch function.
    // We implement it by resolving the ref, writing a new ref, and deleting the old one.

    // 1. Check if we are currently on the branch being renamed
    const current = await git.currentBranch({ fs, dir: path });

    // 2. Resolve the commit hash of the old branch
    const oid = await git.resolveRef({
      fs,
      dir: path,
      ref: oldBranch,
    });

    // 3. Create the new branch pointing to the same commit
    await git.writeRef({
      fs,
      dir: path,
      ref: `refs/heads/${newBranch}`,
      value: oid,
      force: false,
    });

    // 4. If we were on the old branch, switch HEAD to the new branch
    if (current === oldBranch) {
      await git.checkout({
        fs,
        dir: path,
        ref: newBranch,
      });
    }

    // 5. Delete the old branch
    await git.deleteBranch({
      fs,
      dir: path,
      ref: oldBranch,
    });
  }
}

export async function gitClone({
  path,
  url,
  accessToken,
  singleBranch = true,
  depth,
}: GitCloneParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Dugite version (real Git)
    // Build authenticated URL if accessToken is provided and URL doesn't already have auth
    const finalUrl =
      accessToken && !url.includes("@")
        ? url.replace("https://", `https://${accessToken}:x-oauth-basic@`)
        : url;
    const args = ["clone"];
    if (depth && depth > 0) {
      args.push("--depth", String(depth));
    }
    if (singleBranch) {
      args.push("--single-branch");
    }
    args.push("--", finalUrl, path);
    const result = await execGit(args, ".");

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
  } else {
    // isomorphic-git version
    // Strip any embedded auth from URL since isomorphic-git uses onAuth
    const cleanUrl = url.replace(/https:\/\/[^@]+@/, "https://");
    await git.clone({
      fs,
      http,
      dir: path,
      url: cleanUrl,
      onAuth: accessToken
        ? () => ({
            username: accessToken,
            password: "x-oauth-basic",
          })
        : undefined,
      singleBranch,
      depth: depth ?? undefined,
    });
  }
}

export async function gitSetRemoteUrl({
  path,
  remoteUrl,
}: GitSetRemoteUrlParams): Promise<void> {
  const settings = readSettings();

  // Validate remoteUrl to prevent argument injection attacks
  // URLs starting with "-" could be interpreted as command-line options
  if (remoteUrl.startsWith("-")) {
    throw new Error("Invalid remote URL");
  }

  if (settings.enableNativeGit) {
    // Dugite version
    try {
      // Try to add the remote
      const result = await execGit(
        ["remote", "add", "origin", remoteUrl],
        path,
      );

      // If remote already exists, update it instead
      if (result.exitCode !== 0 && result.stderr.includes("already exists")) {
        const updateResult = await execGit(
          ["remote", "set-url", "origin", remoteUrl],
          path,
        );

        if (updateResult.exitCode !== 0) {
          throw new Error(`Failed to update remote: ${updateResult.stderr}`);
        }
      } else if (result.exitCode !== 0) {
        // Handle other errors
        throw new Error(`Failed to add remote: ${result.stderr}`);
      }
    } catch (error: any) {
      logger.error("Error setting up remote:", error);
      throw error; // or handle as needed
    }
  } else {
    //isomorphic-git version
    // Set the remote URL
    await git.setConfig({
      fs,
      dir: path,
      path: "remote.origin.url",
      value: remoteUrl,
    });
    // Set the fetch refspec (required for isomorphic-git to work with remotes)
    await git.setConfig({
      fs,
      dir: path,
      path: "remote.origin.fetch",
      value: "+refs/heads/*:refs/remotes/origin/*",
    });
  }
}

export async function gitPush({
  path,
  branch,
  accessToken,
  force,
  forceWithLease,
}: GitPushParams): Promise<void> {
  const settings = readSettings();
  const targetBranch = branch || "main";

  if (settings.enableNativeGit) {
    try {
      const args = ["push", "origin", `${targetBranch}:${targetBranch}`];
      if (forceWithLease) {
        args.push("--force-with-lease");
      } else if (force) {
        args.push("--force");
      }
      const result = await execGit(args, path);
      if (result.exitCode !== 0) {
        const errorMsg = result.stderr.toString() || result.stdout.toString();
        throw new Error(`Git push failed: ${errorMsg}`);
      }
      return;
    } catch (error: any) {
      logger.error("Error during git push:", error);
      throw new Error(`Git push failed: ${error.message}`);
    }
  }

  // isomorphic-git cannot provide "force-with-lease" safety guarantees.
  if (forceWithLease) {
    logger.warn(
      "gitPush: 'forceWithLease' requested but not supported when native git is disabled. " +
        "Rejecting push to prevent unsafe force operation.",
    );
    throw new Error(
      "gitPush: 'forceWithLease' is not supported when native git is disabled. " +
        "Falling back to plain force could overwrite remote commits. Enable native git.",
    );
  }
  await git.push({
    fs,
    http,
    dir: path,
    remote: "origin",
    ref: targetBranch,
    remoteRef: targetBranch,
    onAuth: accessToken
      ? () => ({
          username: accessToken,
          password: "x-oauth-basic",
        })
      : undefined,
    force: !!force,
  });
}

export async function gitRebaseAbort({ path }: GitBaseParams): Promise<void> {
  const settings = readSettings();
  if (!settings.enableNativeGit) {
    throw new Error(
      "Rebase controls require native Git. Enable native Git in settings.",
    );
  }

  await execOrThrow(["rebase", "--abort"], path, "Failed to abort rebase");
}

export async function gitRebaseContinue({
  path,
}: GitBaseParams): Promise<void> {
  const settings = readSettings();
  if (!settings.enableNativeGit) {
    throw new Error(
      "Rebase controls require native Git. Enable native Git in settings.",
    );
  }

  // Use withGitAuthor since rebase --continue needs to create commits
  // and requires user.name and user.email
  const args = await withGitAuthor(["rebase", "--continue"]);
  await execOrThrow(
    args,
    path,
    "Failed to continue rebase. Make sure conflicts are resolved and changes are staged.",
  );
}

export async function gitRebase({
  path,
  branch,
}: {
  path: string;
  branch: string;
}): Promise<void> {
  const settings = readSettings();
  if (!settings.enableNativeGit) {
    throw new Error(
      "Rebase requires native Git. Enable native Git in settings.",
    );
  }

  // Use withGitAuthor since rebase replays commits and needs user.name and user.email
  // to set the committer identity on the rebased commits
  const args = await withGitAuthor(["rebase", `origin/${branch}`]);
  await execOrThrow(
    args,
    path,
    `Failed to rebase onto origin/${branch}. Make sure you have a clean working directory and the remote branch exists.`,
  );
}

export async function gitMergeAbort({ path }: GitBaseParams): Promise<void> {
  const settings = readSettings();
  if (!settings.enableNativeGit) {
    throw new Error(
      "Merge abort requires native Git. Enable native Git in settings.",
    );
  }

  await execOrThrow(["merge", "--abort"], path, "Failed to abort merge");
}

export async function gitCurrentBranch({
  path,
}: GitBaseParams): Promise<string | null> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Dugite version
    const result = await execGit(["branch", "--show-current"], path);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get current branch: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    const branch = result.stdout.trim() || null;
    return branch;
  } else {
    // isomorphic-git version returns string | undefined
    const branch = await git.currentBranch({
      fs,
      dir: path,
      fullname: false,
    });
    return branch ?? null;
  }
}

export async function gitLog({
  path,
  depth = 100_000,
}: GitLogParams): Promise<GitCommit[]> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    return await gitLogNative(path, depth);
  } else {
    // isomorphic-git fallback: this already returns the same structure
    return await git.log({
      fs,
      dir: path,
      depth,
    });
  }
}

export async function gitIsIgnored({
  path,
  filepath,
}: GitFileParams): Promise<boolean> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    // Dugite version
    // git check-ignore file
    const result = await execGit(["check-ignore", "--", filepath], path);

    // If exitCode == 0 → file is ignored
    if (result.exitCode === 0) return true;

    // If exitCode == 1 → not ignored
    if (result.exitCode === 1) return false;

    // Other exit codes are actual errors
    throw new Error(result.stderr.toString());
  } else {
    // isomorphic-git version
    return await git.isIgnored({
      fs,
      dir: path,
      filepath,
    });
  }
}

export async function gitLogNative(
  path: string,
  depth = 100_000,
): Promise<GitCommit[]> {
  // Use git log with custom format to get all data in a single process
  // Format: %H = commit hash, %at = author timestamp (unix), %B = raw body (message)
  // Using null byte as field separator and custom delimiter between commits
  const logArgs = [
    "log",
    "--max-count",
    String(depth),
    "--format=%H%x00%at%x00%B%x00---END-COMMIT---",
    "HEAD",
  ];

  const logResult = await execGit(logArgs, path);

  if (logResult.exitCode !== 0) {
    throw new Error(logResult.stderr.toString());
  }

  const output = logResult.stdout.toString().trim();
  if (!output) {
    return [];
  }

  // Split by commit delimiter (without newline since trim() removes trailing newline)
  const commitChunks = output.split("\x00---END-COMMIT---").filter(Boolean);
  const entries: GitCommit[] = [];

  for (const chunk of commitChunks) {
    // Split by null byte: [oid, timestamp, message]
    const parts = chunk.split("\x00");
    if (parts.length >= 3) {
      const oid = parts[0].trim();
      const timestamp = Number(parts[1]);
      // Message is everything after the second null byte, may contain null bytes itself
      const message = parts.slice(2).join("\x00");

      entries.push({
        oid,
        commit: {
          message: message,
          author: {
            timestamp: timestamp,
          },
        },
      });
    }
  }

  return entries;
}

export async function gitFetch({
  path,
  remote = "origin",
  accessToken,
}: GitFetchParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(["fetch", remote], path, "Failed to fetch from remote");
  } else {
    await git.fetch({
      fs,
      http,
      dir: path,
      remote,
      onAuth: accessToken
        ? () => ({
            username: accessToken,
            password: "x-oauth-basic",
          })
        : undefined,
    });
  }
}

// Custom error function for git conflicts
export function GitConflictError(message: string): Error {
  const error = new Error(message);
  error.name = "GitConflictError";
  return error;
}

// Custom error function for git operations with structured error codes
export function GitStateError(message: string, code: string): Error {
  const error = new Error(message);
  error.name = "GitStateError";
  (error as any).code = code;
  return error;
}

// Error codes for git state errors
export const GIT_ERROR_CODES = {
  MERGE_IN_PROGRESS: "MERGE_IN_PROGRESS",
  REBASE_IN_PROGRESS: "REBASE_IN_PROGRESS",
} as const;

function hasGitConflictState({ path }: GitBaseParams): boolean {
  return isGitMergeOrRebaseInProgress({ path });
}

export async function gitPull({
  path,
  remote = "origin",
  branch = "main",
  accessToken,
  author,
}: GitPullParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Use withGitAuthor since pull may need to create merge commits
    // and requires user.name and user.email
    const pullArgs = await withGitAuthor([
      "-c",
      "credential.helper=",
      "pull",
      "--rebase=false",
      remote,
      branch,
    ]);
    try {
      await execOrThrow(pullArgs, path, "Failed to pull from remote");
    } catch (error: any) {
      // Check git state files to detect conflicts instead of parsing error messages
      if (hasGitConflictState({ path })) {
        throw GitConflictError(
          `Merge conflict detected during pull. Please resolve conflicts before proceeding.`,
        );
      }
      throw error;
    }
    return;
  }
  try {
    await git.pull({
      fs,
      http,
      dir: path,
      remote,
      ref: branch,
      singleBranch: true,
      author: author || (await getGitAuthor()),
      onAuth: accessToken
        ? () => ({
            username: accessToken,
            password: "x-oauth-basic",
          })
        : undefined,
    });
    // Check for conflicts even if pull succeeded (isomorphic-git may not throw on conflicts)
    if (hasGitConflictState({ path })) {
      throw GitConflictError(
        `Merge conflict detected during pull. Please resolve conflicts before proceeding.`,
      );
    }
  } catch (error: any) {
    // Check git state files to detect conflicts instead of parsing error messages
    if (hasGitConflictState({ path })) {
      throw GitConflictError(
        `Merge conflict detected during pull. Please resolve conflicts before proceeding.`,
      );
    }
    throw error;
  }
}

export async function gitMerge({
  path,
  branch,
  author,
}: GitMergeParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Use withGitAuthor since merge may need to create merge commits
    // and requires user.name and user.email
    const args = await withGitAuthor(["merge", branch]);
    try {
      await execOrThrow(args, path, `Failed to merge branch ${branch}`);
    } catch (error: any) {
      // Check git state files to detect conflicts instead of parsing error messages
      if (hasGitConflictState({ path })) {
        throw GitConflictError(
          `Merge conflict detected during merge. Please resolve conflicts before proceeding.`,
        );
      }
      throw error;
    }
    return;
  }
  try {
    await git.merge({
      fs,
      dir: path,
      ours: "HEAD",
      theirs: branch,
      author: author || (await getGitAuthor()),
    });
    // Check for conflicts even if merge succeeded (isomorphic-git may not throw on conflicts)
    if (hasGitConflictState({ path })) {
      throw GitConflictError(
        `Merge conflict detected during merge. Please resolve conflicts before proceeding.`,
      );
    }
  } catch (error: any) {
    // Check git state files to detect conflicts instead of parsing error messages
    if (hasGitConflictState({ path })) {
      throw GitConflictError(
        `Merge conflict detected during merge. Please resolve conflicts before proceeding.`,
      );
    }
    throw error;
  }
}

export async function gitCreateBranch({
  path,
  branch,
  from = "HEAD",
}: GitCreateBranchParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(
      ["branch", branch, from],
      path,
      `Failed to create branch ${branch}`,
    );
    return;
  }
  // isomorphic-git: branch creation uses the current HEAD; it does not honor "from"
  // in the same way as native `git branch <name> <from>`.
  if (from !== "HEAD") {
    throw new Error(
      `gitCreateBranch: 'from' is not supported when native git is disabled (from=${from}). ` +
        `Branches would be created from HEAD instead.`,
    );
  }
  await git.branch({
    fs,
    dir: path,
    ref: branch,
    checkout: false,
  });
}

export async function gitDeleteBranch({
  path,
  branch,
}: GitDeleteBranchParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await execOrThrow(
      ["branch", "-D", branch],
      path,
      `Failed to delete branch ${branch}`,
    );
  } else {
    await git.deleteBranch({
      fs,
      dir: path,
      ref: branch,
    });
  }
}

export async function gitGetMergeConflicts({
  path,
}: GitBaseParams): Promise<string[]> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // git diff --name-only --diff-filter=U
    const result = (await execGit(
      ["diff", "--name-only", "--diff-filter=U"],
      path,
    )) as unknown as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    if (result.exitCode !== 0) {
      throw new Error(`Failed to get merge conflicts: ${result.stderr}`);
    }
    return result.stdout
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  //throw error("gitGetMergeConflicts requires native Git. Enable native Git in settings.");
  throw new Error(
    "Git conflict detection requires native Git. Enable native Git in settings.",
  );
}

/**
 * Check if Git is currently in a merge or rebase state.
 * This is important because commits are not allowed during merge/rebase
 * if there are still unmerged files.
 */
export function isGitMergeOrRebaseInProgress({ path }: GitBaseParams): boolean {
  const gitDir = pathModule.join(path, ".git");

  // Check for merge in progress
  const mergeHeadPath = pathModule.join(gitDir, "MERGE_HEAD");
  if (fs.existsSync(mergeHeadPath)) {
    return true;
  }

  // Check for rebase in progress
  const rebaseHeadPath = pathModule.join(gitDir, "REBASE_HEAD");
  if (fs.existsSync(rebaseHeadPath)) {
    return true;
  }

  // Check for rebase-apply or rebase-merge directories
  const rebaseApplyPath = pathModule.join(gitDir, "rebase-apply");
  const rebaseMergePath = pathModule.join(gitDir, "rebase-merge");
  if (fs.existsSync(rebaseApplyPath) || fs.existsSync(rebaseMergePath)) {
    return true;
  }

  return false;
}
/**
 * Check if Git is currently in a merge state (not a rebase).
 * This checks for MERGE_HEAD file which indicates a merge is in progress.
 */
export function isGitMergeInProgress({ path }: GitBaseParams): boolean {
  const gitDir = pathModule.join(path, ".git");
  const mergeHeadPath = pathModule.join(gitDir, "MERGE_HEAD");
  return fs.existsSync(mergeHeadPath);
}

/**
 * Check if Git is currently in a rebase state (not a merge).
 * This is used to determine whether to use `git rebase --continue`
 * or `git commit` when completing conflict resolution.
 */
export function isGitRebaseInProgress({ path }: GitBaseParams): boolean {
  const gitDir = pathModule.join(path, ".git");

  // Check for rebase in progress via REBASE_HEAD
  const rebaseHeadPath = pathModule.join(gitDir, "REBASE_HEAD");
  if (fs.existsSync(rebaseHeadPath)) {
    return true;
  }

  // Check for rebase-apply or rebase-merge directories
  const rebaseApplyPath = pathModule.join(gitDir, "rebase-apply");
  const rebaseMergePath = pathModule.join(gitDir, "rebase-merge");
  if (fs.existsSync(rebaseApplyPath) || fs.existsSync(rebaseMergePath)) {
    return true;
  }
  return false;
}
