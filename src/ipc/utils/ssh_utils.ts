import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";

const logger = log.scope("ssh_utils");

export const DEFAULT_KEY_NAME = "dyad_deploy_ed25519";

/** Everything needed to reach a host over SSH with Dyad's dedicated key. */
export interface SshTarget {
  host: string;
  user: string;
  port: number;
  keyName?: string;
}

export type SshErrorKind =
  | "unreachable"
  | "auth-rejected"
  | "host-key-changed"
  | "timeout"
  | "ssh-missing"
  | "unknown";

export interface SshCheckResult {
  ok: boolean;
  errorKind?: SshErrorKind;
  error?: string;
}

// Anything that would prompt must fail or auto-resolve, since these run
// non-interactively. accept-new pins the host key on first contact and rejects
// changed keys afterwards (TOFU); BatchMode prevents password prompts.
export const SSH_BASE_ARGS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ConnectTimeout=10",
];

function sshSearchDirs(): string[] {
  if (process.platform === "win32") {
    return [
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH"),
    ];
  }
  return ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
}

export function findSshBinary(name: string): string {
  const fileName = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of sshSearchDirs()) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to PATH resolution; spawn will fail later if it's absent.
  return name;
}

export function isSshAvailable(): boolean {
  const fileName = process.platform === "win32" ? "ssh.exe" : "ssh";
  if (sshSearchDirs().some((dir) => fs.existsSync(path.join(dir, fileName)))) {
    return true;
  }
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  return pathDirs.some((dir) => dir && fs.existsSync(path.join(dir, fileName)));
}

export function sshKeyDir(): string {
  return path.join(os.homedir(), ".ssh");
}

export function keyFilePath(keyName: string = DEFAULT_KEY_NAME): string {
  return path.join(sshKeyDir(), keyName);
}

export function readPublicKey(
  keyName: string = DEFAULT_KEY_NAME,
): string | null {
  try {
    return fs.readFileSync(`${keyFilePath(keyName)}.pub`, "utf8").trim();
  } catch {
    return null;
  }
}

export function deployKeyExists(keyName: string = DEFAULT_KEY_NAME): boolean {
  return fs.existsSync(keyFilePath(keyName));
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  binary: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = opts?.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Generates the dedicated key if it does not exist and returns the public key.
 * The key is passphrase-less because it is used non-interactively; it is a
 * dedicated identity, never the user's personal key.
 */
export async function ensureDeployKey(
  keyName: string = DEFAULT_KEY_NAME,
): Promise<string> {
  const keyPath = keyFilePath(keyName);
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(sshKeyDir(), { recursive: true, mode: 0o700 });
    const result = await run(
      findSshBinary("ssh-keygen"),
      ["-t", "ed25519", "-N", "", "-C", "dyad-deploy", "-f", keyPath],
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0) {
      throw new Error(`ssh-keygen failed: ${result.stderr.trim()}`);
    }
    logger.info(`Generated deploy key at ${keyPath}`);
  }
  const publicKey = readPublicKey(keyName);
  if (!publicKey) {
    throw new Error(`Deploy key exists but ${keyPath}.pub is unreadable`);
  }
  return publicKey;
}

/**
 * Replaces the key with a freshly generated one and returns its public half.
 *
 * The old pair is kept alongside rather than deleted: it is still the only way
 * back into any server that trusts it, and losing it silently would be worse
 * than leaving a stale file behind.
 */
export async function regenerateDeployKey(
  keyName: string = DEFAULT_KEY_NAME,
): Promise<string> {
  const keyPath = keyFilePath(keyName);
  if (fs.existsSync(keyPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${keyPath}.replaced-${stamp}`;
    fs.renameSync(keyPath, backup);
    if (fs.existsSync(`${keyPath}.pub`)) {
      fs.renameSync(`${keyPath}.pub`, `${backup}.pub`);
    }
    logger.info(`Kept the previous deploy key at ${backup}`);
  }
  return ensureDeployKey(keyName);
}

/** Maps ssh's stderr to an actionable category for connector UIs. */
export function classifySshError(
  stderr: string,
  code: number | null,
): SshErrorKind {
  const text = stderr.toLowerCase();
  if (
    text.includes("remote host identification has changed") ||
    text.includes("host key verification failed")
  ) {
    return "host-key-changed";
  }
  if (text.includes("permission denied")) {
    return "auth-rejected";
  }
  if (text.includes("timed out") || code === null) {
    return "timeout";
  }
  if (
    text.includes("could not resolve hostname") ||
    text.includes("no route to host") ||
    text.includes("connection refused") ||
    text.includes("network is unreachable")
  ) {
    return "unreachable";
  }
  return "unknown";
}

export function sshDestination(target: SshTarget): string {
  return `${target.user}@${target.host}`;
}

export function sshConnectionArgs(target: SshTarget): string[] {
  return [
    ...SSH_BASE_ARGS,
    "-p",
    String(target.port),
    "-i",
    keyFilePath(target.keyName),
    sshDestination(target),
  ];
}

export interface RemoteExecResult extends SshCheckResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Runs a single command on the remote host and captures its output.
 *
 * Callers compose the command string; nothing here escapes it, so never
 * interpolate untrusted input into it.
 */
export async function runRemote(
  target: SshTarget,
  command: string,
  opts?: { timeoutMs?: number },
): Promise<RemoteExecResult> {
  if (!isSshAvailable()) {
    return {
      ok: false,
      errorKind: "ssh-missing",
      error: "OpenSSH client not found on this machine",
      stdout: "",
      stderr: "",
      code: null,
    };
  }
  try {
    const result = await run(
      findSshBinary("ssh"),
      [...sshConnectionArgs(target), command],
      { timeoutMs: opts?.timeoutMs ?? 20_000 },
    );
    if (result.code === 0) {
      return {
        ok: true,
        stdout: result.stdout,
        stderr: result.stderr,
        code: 0,
      };
    }
    return {
      ok: false,
      errorKind: classifySshError(result.stderr, result.code),
      error: result.stderr.trim() || `ssh exited with code ${result.code}`,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    };
  } catch (err) {
    return {
      ok: false,
      errorKind: "unknown",
      error: err instanceof Error ? err.message : String(err),
      stdout: "",
      stderr: "",
      code: null,
    };
  }
}

/**
 * Runs a long command remotely, reporting output as it arrives.
 *
 * `runRemote` buffers and times out in seconds, which suits a status check but
 * not an install that takes minutes and says a lot on the way.
 */
export function runRemoteStreaming(
  target: SshTarget,
  command: string,
  {
    onOutput,
    timeoutMs = 15 * 60 * 1000,
  }: { onOutput: (chunk: string) => void; timeoutMs?: number },
): Promise<{ ok: boolean; code: number | null; error?: string }> {
  if (!isSshAvailable()) {
    return Promise.resolve({
      ok: false,
      code: null,
      error: "OpenSSH client not found on this machine",
    });
  }
  return new Promise((resolve) => {
    const child = spawn(
      findSshBinary("ssh"),
      [...sshConnectionArgs(target), command],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let tail = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const handle = (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      onOutput(text);
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        error:
          code === 0
            ? undefined
            : `Command exited with code ${code}. ${tail.slice(-500)}`,
      });
    });
  });
}

export async function testConnection(
  target: SshTarget,
): Promise<SshCheckResult> {
  const result = await runRemote(target, "echo ok");
  if (result.ok && result.stdout.includes("ok")) {
    return { ok: true };
  }
  return { ok: false, errorKind: result.errorKind, error: result.error };
}
