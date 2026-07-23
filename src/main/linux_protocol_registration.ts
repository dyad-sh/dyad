import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";

const logger = log.scope("linux_protocol");
const execFileAsync = promisify(execFile);

const SCHEME = "dyad";
const MIME_TYPE = `x-scheme-handler/${SCHEME}`;
const DESKTOP_FILENAME = `${SCHEME}-url-handler.desktop`;

interface ExecInputs {
  // process.defaultApp: true for dev / unpackaged runs.
  defaultApp: boolean;
  // process.execPath: the electron binary (dev) or installed binary (deb/rpm).
  execPath: string;
  // process.argv: argv[1] is the app entry script in dev.
  argv: string[];
  // process.env.APPIMAGE: stable path to the .AppImage, set by the runtime.
  appImagePath: string | undefined;
  // process.env.NODE_ENV: "development" for `npm start`. The dev instance keys
  // its userData (and thus its single-instance lock) off this, so a relaunched
  // handler must carry the same value to reach the running dev instance rather
  // than the default userData a packaged install uses. See computeExecCommand.
  nodeEnv: string | undefined;
  // Absolute userData dir the running dev instance is using (app.getPath).
  // In dev, getUserDataPath() falls back to path.resolve("./userData"), i.e.
  // relative to the CWD. The OS launches the deep-link handler from a different
  // CWD than `npm start` did, so without pinning this the relaunch computes a
  // different userData, grabs a different single-instance lock, and opens a
  // second dev window instead of forwarding. Baked in via DYAD_DEV_USER_DATA_DIR.
  devUserDataDir: string | undefined;
}

interface ExecCommand {
  // Full Exec line including the `%u` field code that injects the URL.
  exec: string;
  // Bare binary for TryExec, so a stale entry self-disables if it's gone.
  tryExec: string;
}

// Double-quote a path for a .desktop Exec value. Inside the quotes the
// characters " ` $ \ must each be escaped with a backslash. Field codes like
// `%u` must stay outside the quotes.
function quote(value: string): string {
  return `"${value.replace(/(["`$\\])/g, "\\$1")}"`;
}

// The Exec target differs per packaging format. Pure so it can be unit-tested
// without touching the real environment.
export function computeExecCommand(inputs: ExecInputs): ExecCommand {
  const { defaultApp, execPath, argv, appImagePath, nodeEnv, devUserDataDir } =
    inputs;

  // AppImage: process.execPath points at the ephemeral /tmp/.mount_* extract
  // that changes every launch, so it must not be used. appImagePath (from
  // process.env.APPIMAGE) is the stable location of the .AppImage file itself.
  if (!defaultApp && appImagePath) {
    return {
      exec: `${quote(appImagePath)} %u`,
      tryExec: appImagePath,
    };
  }

  // Dev / unpackaged: electron binary plus the app entry script.
  if (defaultApp && argv.length >= 2) {
    const script = path.resolve(argv[1]);
    // When the OS opens a dyad:// link it launches this Exec line as a fresh
    // process. To forward the deep link into the *running* dev instance it must
    // land on the same single-instance lock, which is keyed off the dev
    // userData. main.ts only selects that userData when NODE_ENV ===
    // "development", and getUserDataPath() then resolves "./userData" relative
    // to the CWD. A bare `electron .` launch (a) omits NODE_ENV, defaulting to
    // ~/.config/dyad — the userData a packaged install uses — and (b) runs from
    // the launcher's CWD, not the project root, so even with NODE_ENV set the
    // relative path points elsewhere. Either way it grabs a different lock and
    // opens a second window instead of forwarding. Pin both: NODE_ENV via `env`,
    // and the exact absolute userData via DYAD_DEV_USER_DATA_DIR. `-u
    // ELECTRON_RUN_AS_NODE` guards the rare case where the launching environment
    // has it set, which would run electron as plain node.
    const envAssignments =
      nodeEnv === "development"
        ? [
            "env",
            "-u",
            "ELECTRON_RUN_AS_NODE",
            `NODE_ENV=${nodeEnv}`,
            // Quote the whole VAR=value token, not just the value: the Desktop
            // Entry spec only recognizes an argument as quoted when it *begins*
            // with `"`, so a mid-argument quote (VAR="/a b") can be mis-split by
            // a strict parser. env(1) receives VAR=value as one argv element.
            ...(devUserDataDir
              ? [quote(`DYAD_DEV_USER_DATA_DIR=${devUserDataDir}`)]
              : []),
          ]
        : [];
    const envPrefix =
      envAssignments.length > 0 ? `${envAssignments.join(" ")} ` : "";
    return {
      exec: `${envPrefix}${quote(execPath)} ${quote(script)} %u`,
      tryExec: execPath,
    };
  }

  // Packaged deb / rpm: the installed binary is stable.
  return {
    exec: `${quote(execPath)} %u`,
    tryExec: execPath,
  };
}

// Pure: render the .desktop contents. NoDisplay keeps it out of app menus
// (it's a URL-handler shim, not a launcher).
export function buildDesktopFile(command: ExecCommand): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Dyad",
    `Exec=${command.exec}`,
    // TryExec is a bare path; the spec doesn't allow it to be quoted or escaped.
    `TryExec=${command.tryExec}`,
    `MimeType=${MIME_TYPE};`,
    "NoDisplay=true",
    "Terminal=false",
    "",
  ].join("\n");
}

// Register this build as the dyad:// handler. Linux only; best-effort.
//
// Electron's setAsDefaultProtocolClient doesn't reliably do this on Linux, so
// we write the .desktop file ourselves and point the OS at it. We do it on
// every startup so the handler always points at the build the user launched last.
// The file goes under ~/.local/share (this user only), so it won't clash with
// a deb/rpm system install.
// `devUserDataDir` should be the running instance's app.getPath("userData"); it
// is baked into the dev handler so a browser-launched deep link forwards into
// this instance regardless of the launcher's working directory. Callers in the
// main process pass it; it's ignored outside dev.
export async function registerDyadProtocolLinux(
  devUserDataDir?: string,
): Promise<void> {
  if (process.platform !== "linux") {
    return;
  }
  // Don't mutate the host mime database during E2E runs.
  if (IS_TEST_BUILD) {
    return;
  }

  try {
    const command = computeExecCommand({
      defaultApp: Boolean(process.defaultApp),
      execPath: process.execPath,
      argv: process.argv,
      appImagePath: process.env.APPIMAGE,
      nodeEnv: process.env.NODE_ENV,
      devUserDataDir,
    });

    // Honor XDG_DATA_HOME so the file lands where the desktop environment
    // actually searches; fall back to the spec default otherwise.
    const dataHome =
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    const appsDir = path.join(dataHome, "applications");
    const desktopPath = path.join(appsDir, DESKTOP_FILENAME);

    await fs.promises.mkdir(appsDir, { recursive: true });
    await fs.promises.writeFile(desktopPath, buildDesktopFile(command));

    // Refresh the desktop database cache. The update-desktop-database command
    // isn't installed on every distro; if it's missing, the xdg-mime call below
    // still updates ~/.config/mimeapps.list on its own. The timeout guards
    // against either tool hanging on a stale lock or corrupt database.
    await execFileAsync("update-desktop-database", [appsDir], {
      timeout: 5000,
    }).catch((error) => {
      logger.warn("update-desktop-database failed:", error);
    });

    // xdg-mime is the step that actually sets the default, so only claim
    // success when it succeeds.
    const registered = await execFileAsync(
      "xdg-mime",
      ["default", DESKTOP_FILENAME, MIME_TYPE],
      { timeout: 5000 },
    )
      .then(() => true)
      .catch((error) => {
        logger.warn("xdg-mime default failed:", error);
        return false;
      });

    if (registered) {
      logger.info(`Registered ${MIME_TYPE} handler at ${desktopPath}`);
    }
  } catch (error) {
    logger.warn("Failed to register dyad:// protocol handler:", error);
  }
}
