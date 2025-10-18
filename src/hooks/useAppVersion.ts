import { useState, useEffect } from "react";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * A hook to get the application version.
 * @returns {string | null} The application version, or null if it cannot be fetched.
 */
export function useAppVersion() {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await IpcClient.getInstance().getAppVersion();
        setAppVersion(version);
      } catch {
        setAppVersion(null);
      }
    };
    fetchVersion();
  }, []);

  return appVersion;
}
