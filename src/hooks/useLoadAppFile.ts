import { useState, useEffect } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import log from "electron-log";

const logger = log.scope("useLoadAppFile");

export function useLoadAppFile(appId: number | null, filePath: string | null) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const loadFile = async () => {
      if (appId === null || filePath === null) {
        setContent(null);
        setError(null);
        return;
      }

      setLoading(true);
      try {
        const ipcClient = IpcClient.getInstance();
        const fileContent = await ipcClient.readAppFile(appId, filePath);

        setContent(fileContent);
        setError(null);
      } catch (error) {
        logger.error(
          `Error loading file ${filePath} for app ${appId}:`,
          error,
        );
        setError(error instanceof Error ? error : new Error(String(error)));
        setContent(null);
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [appId, filePath]);

  const refreshFile = async () => {
    if (appId === null || filePath === null) {
      return;
    }

    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      const fileContent = await ipcClient.readAppFile(appId, filePath);
      setContent(fileContent);
      setError(null);
    } catch (error) {
      logger.error(
        `Error refreshing file ${filePath} for app ${appId}:`,
        error,
      );
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  };

  return { content, loading, error, refreshFile };
}
