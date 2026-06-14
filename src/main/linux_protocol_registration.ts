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
  const { defaultApp, execPath, argv, appImagePath } = inputs;

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
    return {
      exec: `${quote(execPath)} ${quote(script)} %u`,
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
export async function registerDyadProtocolLinux(): Promise<void> {
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
