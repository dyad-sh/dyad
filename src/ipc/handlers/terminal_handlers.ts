import { app } from "electron";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { terminalContracts } from "../types/terminal";
import { getPtySessionManager } from "../utils/pty_session_manager";

const logger = log.scope("terminal_handlers");
let registeredBeforeQuitCleanup = false;

export function registerTerminalHandlers() {
  const manager = getPtySessionManager();

  createTypedHandler(terminalContracts.open, async (event, params) => {
    return manager.openSession({
      appId: params.appId,
      cols: params.cols,
      rows: params.rows,
      sender: event.sender,
    });
  });

  createTypedHandler(terminalContracts.close, async (event, params) => {
    manager.closeSession(params.sessionId, event.sender);
    return { ok: true as const };
  });

  createTypedHandler(terminalContracts.kill, async (_, params) => {
    manager.killSession(params.sessionId);
    return { ok: true as const };
  });

  createTypedHandler(terminalContracts.write, async (_, params) => {
    manager.write(params.sessionId, params.data);
    return { ok: true as const };
  });

  createTypedHandler(terminalContracts.resize, async (_, params) => {
    manager.resize(params.sessionId, params.cols, params.rows);
    return { ok: true as const };
  });

  createTypedHandler(terminalContracts.serialize, async (_, params) => {
    return { scrollback: manager.serialize(params.sessionId) };
  });

  if (!registeredBeforeQuitCleanup) {
    registeredBeforeQuitCleanup = true;
    app?.on?.("before-quit", () => {
      logger.debug("Killing terminal PTY sessions before quit");
      manager.killAll();
    });
  }

  logger.debug("Registered terminal IPC handlers");
}
