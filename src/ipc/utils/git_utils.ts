import { getGitAuthor } from "./git_author";
import git from "isomorphic-git";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import pathModule from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readSettings } from "../../main/settings";

const execAsync = promisify(exec);

async function verboseExecAsync(
  command: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(command);
  } catch (error: any) {
    let errorMessage = `Error: ${error.message}`;
    if (error.stdout) {
      errorMessage += `\nStdout: ${error.stdout}`;
    }
    if (error.stderr) {
      errorMessage += `\nStderr: ${error.stderr}`;
    }
    throw new Error(errorMessage);
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
    let command = `git -C "${path}" commit -m "${message.replace(/"/g, '\\"')}"`;
    if (amend) {
      command += " --amend";
    }

    await verboseExecAsync(command);
    const { stdout } = await execAsync(`git -C "${path}" rev-parse HEAD`);
    return stdout.trim();
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
    await execAsync(`git -C "${path}" checkout "${ref.replace(/"/g, '\\"')}"`);
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
    const { stdout: currentHead } = await execAsync(
      `git -C "${path}" rev-parse HEAD`,
    );
    const currentCommit = currentHead.trim();

    // If we're already at the target commit, nothing to do
    if (currentCommit === targetOid) {
      return;
    }

    // Safety: refuse to run if the work-tree isn't clean.
    const { stdout: wtStatus } = await execAsync(
      `git -C "${path}" status --porcelain`,
    );
    if (wtStatus.trim() !== "") {
      throw new Error("Cannot revert: working tree has uncommitted changes.");
    }

    // Reset the working directory and index to match the target commit state
    // This effectively undoes all changes since the target commit
    await execAsync(`git -C "${path}" reset --hard "${targetOid}"`);

    // Reset back to the original HEAD but keep the working directory as it is
    // This stages all the changes needed to revert to the target state
    await execAsync(`git -C "${path}" reset --soft "${currentCommit}"`);
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
    await execAsync(`git -C "${path}" add .`);
    return;
  } else {
    return git.add({ fs, dir: path, filepath: "." });
  }
}
