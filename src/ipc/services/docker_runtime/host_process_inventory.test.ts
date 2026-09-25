import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every production file that starts a process, and why that is safe in
 * Docker mode, where app-controlled code must never run on the host.
 *
 * - `dyad-owned`: runs only Dyad's own or system binaries (git, ripgrep,
 *   docker, the Claude CLI, OS probes), never a command read from the app.
 * - `docker-routed`: can run app code, and routes it into the container in
 *   Docker mode (or refuses there). Must reference the Docker runtime.
 * - `host-mode-only`: runs app code, but is only reachable in Local mode;
 *   the comment names the gate.
 * - `via-routed-helper`: starts processes only through a helper that routes
 *   into the container in Docker mode; the comment names the helper.
 * - `runner`: a generic process helper; its callers are listed here instead.
 *
 * A new file that starts processes fails this test until it is classified.
 */
const INVENTORY: Record<
  string,
  | "dyad-owned"
  | "docker-routed"
  | "host-mode-only"
  | "via-routed-helper"
  | "runner"
> = {
  "src/main.ts": "dyad-owned",
  "src/main/linux_protocol_registration.ts": "dyad-owned",
  "src/utils/process_memory_diagnostics.ts": "dyad-owned",
  "src/ipc/handlers/node_handlers.ts": "dyad-owned",
  // node/pnpm version probes for diagnostics, not run in the app directory.
  "src/ipc/handlers/debug_handlers.ts": "dyad-owned",
  "src/ipc/services/claude_code/runtime.ts": "dyad-owned",
  "src/ipc/services/docker_runtime/docker_cli.ts": "dyad-owned",
  "src/ipc/services/git_overlay_workspace.ts": "dyad-owned",
  "src/ipc/utils/git_utils.ts": "dyad-owned",
  "src/ipc/utils/managed_node.ts": "dyad-owned",
  "src/ipc/utils/windows_env_path.ts": "dyad-owned",
  "src/ipc/utils/kill_process_tree_sync.ts": "dyad-owned",
  "src/pro/main/ipc/handlers/local_agent/tools/grep.ts": "dyad-owned",
  // process_manager spawns `docker stop` / `docker volume rm` only.
  "src/ipc/utils/process_manager.ts": "dyad-owned",
  // ripgrep for search, and `docker volume rm` when an app is deleted.
  "src/ipc/handlers/app_handlers.ts": "dyad-owned",

  "src/ipc/services/app_runtime_service.ts": "docker-routed",
  "src/ipc/handlers/tests_handlers.ts": "docker-routed",
  "src/ipc/utils/playwright_bootstrap.ts": "docker-routed",
  "src/ipc/processors/tsc.ts": "docker-routed",
  "src/ipc/processors/code_explorer.ts": "docker-routed",
  "src/ipc/processors/supabase_dependency_analysis.ts": "docker-routed",
  "src/ipc/processors/executeAddDependency.ts": "docker-routed",
  "src/ipc/services/isolated_package_install.ts": "docker-routed",
  "src/ipc/services/pre_commit_service.ts": "docker-routed",
  "src/ipc/handlers/app_upgrade_handlers.ts": "docker-routed",
  "src/ipc/handlers/capacitor_handlers.ts": "docker-routed",
  "src/ipc/utils/app_upgrade_utils.ts": "docker-routed",
  "src/ipc/utils/portal_migration.ts": "docker-routed",
  "src/pro/main/ipc/handlers/local_agent/tools/run_build.ts": "docker-routed",
  "src/pro/main/ipc/handlers/local_agent/tools/run_pre_commit.ts":
    "docker-routed",
  "src/ipc/services/docker_runtime/guest_command.ts": "docker-routed",

  // simpleSpawnWithDeniedPnpmBuildSelfHeal (app_upgrade_utils.ts).
  "src/ipc/utils/pnpm_migration.ts": "via-routed-helper",

  // Sandboxed E2E dev server: only reached when usesSandboxedE2eTests(),
  // which is false in Docker mode.
  "src/ipc/services/e2e_test_runtime.ts": "host-mode-only",

  "src/ipc/utils/buffered_process.ts": "runner",
  "src/ipc/utils/spawn_streaming.ts": "runner",
  "src/ipc/utils/simpleSpawn.ts": "runner",
  "src/ipc/utils/pty_command_runner.ts": "runner",
  "src/ipc/utils/runShellCommand.ts": "runner",
  "src/ipc/utils/socket_firewall.ts": "runner",
};

const PROCESS_START =
  /\b(spawnStreaming|runBufferedProcess|simpleSpawn\w*|runPtyCommand|execFileAsync|execFile|execSync|spawnSync|runShellCommand)\(|\bspawn\(|utilityProcess\.fork\(|\brunCommand\("/;
const DOCKER_AWARE =
  /isDockerRuntimeActive|assertSupportedOutsideDocker|docker_runtime\/|runGuest(Streaming|Buffered)/;

const repoRoot = path.resolve(__dirname, "../../../..");

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["__tests__", "testing", "node_modules"].includes(entry.name)) {
        continue;
      }
      out.push(...productionFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("host process inventory", () => {
  const files = ["src", "workers"].flatMap((dir) =>
    productionFiles(path.join(repoRoot, dir)),
  );
  const starters = files
    .filter((file) => PROCESS_START.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
    .sort();

  it("classifies every file that starts a process", () => {
    const unclassified = starters.filter((file) => !(file in INVENTORY));
    expect(
      unclassified,
      "New process-starting file(s). If they can run app code, route them through the Docker runtime in Docker mode, then classify them in INVENTORY.",
    ).toEqual([]);
  });

  it("keeps docker-routed files wired to the Docker runtime", () => {
    const unwired = Object.entries(INVENTORY)
      .filter(([, kind]) => kind === "docker-routed")
      .map(([file]) => file)
      .filter(
        (file) =>
          !DOCKER_AWARE.test(
            fs.readFileSync(path.join(repoRoot, file), "utf8"),
          ),
      );
    expect(unwired).toEqual([]);
  });

  it("has no stale entries", () => {
    const missing = Object.keys(INVENTORY).filter(
      (file) => !fs.existsSync(path.join(repoRoot, file)),
    );
    expect(missing).toEqual([]);
  });
});
