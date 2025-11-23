import { getGitAuthor } from "./git_author";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { exec } from "dugite";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import pathModule from "node:path";
import { readSettings } from "../../main/settings";
import log from "electron-log";
const logger = log.scope("git_utils");
import type {
  GitBaseParams,
  GitFileParams,
  GitCheckoutParams,
  GitBranchRenameParams,
  GitCloneParams,
  GitCommitParams,
  GitLogParams,
  GitCommit,
  GitFileAtCommitParams,
  GitSetRemoteUrlParams,
  GitStageToRevertParams,
  GitInitParams,
  GitPushParams,
} from "../git_types";

export async function getCurrentCommitHash({
  path,
  ref = "HEAD",
}: GitInitParams): Promise<string> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    const result = await exec(["rev-parse", ref], path);
    return result.stdout.trim();
  } else {
    return await git.resolveRef({
      fs,
      dir: path,
      ref,
    });
  }
}

export async function gitCommit({
  path,
  message,
  amend,
}: GitCommitParams): Promise<string> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Perform the commit using dugite
    const args = ["commit", "-m", message];
    if (amend) {
      args.push("--amend");
    }
    await exec(args, path);
    // Get the new commit hash
    const result = await exec(["rev-parse", "HEAD"], path);
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
    await exec(["checkout", ref], path);
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
    const { stdout: currentHead } = await exec(["rev-parse", "HEAD"], path);

    const currentCommit = currentHead.trim();

    // If we're already at the target commit, nothing to do
    if (currentCommit === targetOid) {
      return;
    }

    // Safety: refuse to run if the work-tree isn't clean.
    const { stdout: wtStatus } = await exec(["status", "--porcelain"], path);
    if (wtStatus.trim() !== "") {
      throw new Error("Cannot revert: working tree has uncommitted changes.");
    }

    // Reset the working directory and index to match the target commit state
    // This effectively undoes all changes since the target commit
    await exec(["reset", "--hard", targetOid], path);

    // Reset back to the original HEAD but keep the working directory as it is
    // This stages all the changes needed to revert to the target state
    await exec(["reset", "--soft", currentCommit], path);
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
    await exec(["add", "."], path);
    return;
  } else {
    return git.add({ fs, dir: path, filepath: "." });
  }
}

export async function gitAdd({ path, filepath }: GitFileParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await exec(["add", "--", filepath], path);
  } else {
    await git.add({
      fs,
      dir: path,
      filepath,
    });
  }
}

export async function gitInit({
  path,
  ref = "main",
}: GitInitParams): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await exec(["init", "-b", ref], path);
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
    await exec(["rm", "-f", filepath], path);
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
    const result = await exec(["status", "--porcelain"], path);
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

export async function getFileAtCommit({
  path,
  filePath,
  commitHash,
}: GitFileAtCommitParams): Promise<string | null> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    try {
      const { stdout } = await exec(
        ["show", `${commitHash}:${filePath}`],
        path,
      );
      return stdout;
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
    const result = await exec(["branch", "--list"], path);

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

export async function gitRenameBranch({
  path,
  oldBranch,
  newBranch,
}: GitBranchRenameParams): Promise<void> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    // git branch -m oldBranch newBranch
    const result = await exec(["branch", "-m", oldBranch, newBranch], path);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
  } else {
    await git.renameBranch({
      fs,
      dir: path,
      oldref: oldBranch,
      ref: newBranch,
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
    args.push(finalUrl, path);
    const result = await exec(args, ".");

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

  if (settings.enableNativeGit) {
    // Dugite version
    try {
      // First check if remote exists
      const checkResult = await exec(["remote", "get-url", "origin"], path);

      if (checkResult.exitCode === 0) {
        // Remote exists, update it
        const result = await exec(
          ["remote", "set-url", "origin", remoteUrl],
          path,
        );
        if (result.exitCode !== 0) {
          throw new Error(
            `Failed to set remote URL: ${result.stderr.toString()}`,
          );
        }
      } else {
        throw new Error(
          `Remote does not exist: ${checkResult.stderr.toString()}`,
        );
      }
    } catch (error: any) {
      logger.error("Error setting remote URL:", error);
      throw new Error(`Error setting remote URL: ${error.message}`);
    }
  } else {
    //isomorphic-git version
    await git.setConfig({
      fs,
      dir: path,
      path: "remote.origin.url",
      value: remoteUrl,
    });
  }
}

export async function gitPush({
  path,
  branch,
  accessToken,
  force,
}: GitPushParams): Promise<void> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    // Dugite version
    try {
      // Push using the configured origin remote (which already has auth in URL)
      const args = ["push", "origin", `main:${branch}`];
      if (force) {
        args.push("--force");
      }
      const result = await exec(args, path);

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr.toString() || result.stdout.toString();
        throw new Error(`Git push failed: ${errorMsg}`);
      }
    } catch (error: any) {
      logger.error("Error during git push:", error);
      throw new Error(`Git push failed: ${error.message}`);
    }
  } else {
    // isomorphic-git version
    await git.push({
      fs,
      http,
      dir: path,
      remote: "origin",
      ref: "main",
      remoteRef: branch,
      onAuth: () => ({
        username: accessToken,
        password: "x-oauth-basic",
      }),
      force: !!force,
    });
  }
}

export async function gitCurrentBranch({
  path,
}: GitBaseParams): Promise<string | null> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Dugite version
    const result = await exec(["branch", "--show-current"], path);
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
    try {
      // Format: %H = commit hash, %s = subject, %at = author timestamp
      const result = await exec(
        ["log", "--format=%H%n%s%n%at%n---END---", "-n", depth.toString()],
        path,
      );
      const output = result.stdout.trim();
      if (!output) {
        return [];
      }
      const commits = output
        .split("---END---\n")
        .filter((block) => block.trim());
      return commits.map((block) => {
        const lines = block.trim().split("\n");
        const oid = lines[0];
        const message = lines[1] || "";
        const timestamp = parseInt(lines[2] || "0", 10);

        return {
          oid,
          commit: {
            message,
            author: {
              timestamp,
            },
          },
        };
      });
    } catch (error) {
      logger.warn(`Git log failed: ${error}`);
      return [];
    }
  } else {
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
    const result = await exec(["check-ignore", filepath], path);

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
