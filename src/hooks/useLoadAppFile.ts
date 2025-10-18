import { useState, useEffect } from "react";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * A hook for loading the content of a file in an app.
 * @param {number | null} appId - The ID of the app.
 * @param {string | null} filePath - The path to the file.
 * @returns {object} An object with the file content, loading state, error, and a function to refresh the file.
 * @property {string | null} content - The content of the file.
 * @property {boolean} loading - Whether the file is being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => Promise<void>} refreshFile - A function to refresh the file.
 */
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
        console.error(
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
      console.error(
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
