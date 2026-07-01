import { spawn } from "child_process";
import log from "electron-log/main";
import { getPackageManagerCommandEnv } from "./socket_firewall";

const logger = log.scope("simpleSpawn");

export async function simpleSpawn({
  command,
  cwd,
  successMessage,
  errorPrefix,
  env,
}: {
  command: string;
  cwd: string;
  successMessage: string;
  errorPrefix: string;
  // Defaults to getPackageManagerCommandEnv() so Dyad-managed commands see
  // the managed pnpm and the Corepack project-spec disable without every
  // call site having to remember to pass it.
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const spawnEnv = env ?? getPackageManagerCommandEnv();
  return new Promise<void>((resolve, reject) => {
    logger.info(`Running: ${command}`);
    const process = spawn(command, {
      cwd,
      shell: true,
      stdio: "pipe",
      env: spawnEnv,
    });

    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      logger.info(output);
    });

    process.stderr?.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      logger.error(output);
    });

    process.on("close", (code) => {
      if (code === 0) {
        logger.info(successMessage);
        resolve();
      } else {
        logger.error(`${errorPrefix}, exit code ${code}`);
        const errorMessage = `${errorPrefix} (exit code ${code})\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
        reject(new Error(errorMessage));
      }
    });

    process.on("error", (err) => {
      logger.error(`Failed to spawn command: ${command}`, err);
      const errorMessage = `Failed to spawn command: ${err.message}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
      reject(new Error(errorMessage));
    });
  });
}
