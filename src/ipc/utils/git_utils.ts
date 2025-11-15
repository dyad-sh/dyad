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

export async function getCurrentCommitHash({
  path,
  ref = "HEAD",
}: {
  path: string;
  ref?: string;
}): Promise<string> {
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
}: {
  path: string;
  message: string;
  amend?: boolean;
}): Promise<string> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    // Perform the commit using dugite
    const args = ["commit", "-m", message.replace(/"/g, '\\"').trim()];
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
}: {
  path: string;
  ref: string;
}): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await exec(["checkout", ref.replace(/"/g, '\\"').trim()], path);
    return;
  } else {
    return git.checkout({ fs, dir: path, ref });
  }
}

export async function gitStageToRevert({
  path,
  targetOid,
}: {
  path: string;
  targetOid: string;
}): Promise<void> {
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

export async function gitAddAll({ path }: { path: string }): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await exec(["add", "."], path);
    return;
  } else {
    return git.add({ fs, dir: path, filepath: "." });
  }
}

export async function gitAdd({
  path,
  filepath,
}: {
  path: string;
  filepath: string;
}): Promise<void> {
  const settings = readSettings();
  if (settings.enableNativeGit) {
    await exec(["add", filepath], path);
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
}: {
  path: string;
  ref?: string;
}): Promise<void> {
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
}: {
  path: string;
  filepath: string;
}): Promise<void> {
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

export async function gitStatus({ path }: { path: string }): Promise<string[]> {
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
}: {
  path: string;
  filePath: string;
  commitHash: string;
}): Promise<string | null> {
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
}: {
  path: string;
}): Promise<string[]> {
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
}: {
  path: string;
  oldBranch: string;
  newBranch: string;
}): Promise<void> {
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
}: {
  path: string;
  url: string;
}): Promise<void> {
  const settings = readSettings();

  if (settings.enableNativeGit) {
    //  Dugite version: real Git clone
    const result = await exec(
      ["clone", "--depth", "1", "--single-branch", url, path],
      ".",
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
  } else {
    //  isomorphic-git version (JS-based fallback)
    await git.clone({
      fs,
      http,
      dir: path,
      url,
      singleBranch: true,
      depth: 1,
    });
  }
}
