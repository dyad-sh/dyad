import { ipcMain } from "electron";
import { ClaudeWrapper, ClaudeOptions, ClaudeResponse } from "../utils/claude_code/claude_wrapper";
import { cleanupOldTempFiles } from "../utils/claude_code_wrapper";
import log from "electron-log/main";

const logger = log.scope("claude-wrapper-handlers");

// Global Claude wrapper instance
let claudeWrapper: ClaudeWrapper | null = null;

export function registerClaudeWrapperHandlers(): void {
  // Clean up any old temporary files on startup
  cleanupOldTempFiles();
  
  // Start Claude process
  ipcMain.handle("claude-wrapper:start", async (_, options: ClaudeOptions): Promise<{ success: boolean; error?: string }> => {
    try {
      logger.info("Starting Claude wrapper with options:", options);
      
      if (claudeWrapper) {
        await claudeWrapper.stop();
      }

      claudeWrapper = new ClaudeWrapper(options);
      
      // Set up event forwarding to renderer
      claudeWrapper.on('claude-output', (data: string) => {
        // Forward to all renderer processes
        if ((global as any).mainWindow) {
          (global as any).mainWindow.webContents.send('claude-wrapper:output', data);
        }
      });

      claudeWrapper.on('claude-error', (error: string) => {
        if ((global as any).mainWindow) {
          (global as any).mainWindow.webContents.send('claude-wrapper:error', error);
        }
      });

      claudeWrapper.on('permission-request', (request: string) => {
        if ((global as any).mainWindow) {
          (global as any).mainWindow.webContents.send('claude-wrapper:permission-request', request);
        }
      });

      claudeWrapper.on('claude-exit', (code: number | null) => {
        if ((global as any).mainWindow) {
          (global as any).mainWindow.webContents.send('claude-wrapper:exit', code);
        }
      });

      await claudeWrapper.startClaude();
      
      return { success: true };
    } catch (error) {
      logger.error("Failed to start Claude wrapper:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Send command to Claude
  ipcMain.handle("claude-wrapper:send-command", async (_, command: string): Promise<ClaudeResponse> => {
    try {
      if (!claudeWrapper) {
        throw new Error("Claude wrapper not initialized");
      }

      logger.info("Sending command to Claude:", command);
      return await claudeWrapper.sendCommand(command);
    } catch (error) {
      logger.error("Error sending command to Claude:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // Send raw input to Claude
  ipcMain.handle("claude-wrapper:send-input", async (_, input: string): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!claudeWrapper) {
        throw new Error("Claude wrapper not initialized");
      }

      await claudeWrapper.sendInput(input);
      return { success: true };
    } catch (error) {
      logger.error("Error sending input to Claude:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Approve permission request
  ipcMain.handle("claude-wrapper:approve-permission", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!claudeWrapper) {
        throw new Error("Claude wrapper not initialized");
      }

      await claudeWrapper.approvePermission();
      return { success: true };
    } catch (error) {
      logger.error("Error approving permission:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Deny permission request
  ipcMain.handle("claude-wrapper:deny-permission", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!claudeWrapper) {
        throw new Error("Claude wrapper not initialized");
      }

      await claudeWrapper.denyPermission();
      return { success: true };
    } catch (error) {
      logger.error("Error denying permission:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Stop Claude process
  ipcMain.handle("claude-wrapper:stop", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!claudeWrapper) {
        return { success: true }; // Already stopped
      }

      await claudeWrapper.stop();
      claudeWrapper = null;
      return { success: true };
    } catch (error) {
      logger.error("Error stopping Claude wrapper:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get Claude status
  ipcMain.handle("claude-wrapper:status", async (): Promise<{
    running: boolean;
    currentOutput?: string;
    currentError?: string;
  }> => {
    if (!claudeWrapper) {
      return { running: false };
    }

    return {
      running: claudeWrapper.running,
      currentOutput: claudeWrapper.currentOutput,
      currentError: claudeWrapper.currentError
    };
  });

  logger.info("Claude wrapper handlers registered");
}