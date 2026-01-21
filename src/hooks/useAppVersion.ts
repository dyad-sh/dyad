import { useState, useEffect } from "react";
import { ipc } from "@/ipc/types";

export function useAppVersion() {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const result = await ipc.system.getAppVersion();
        setAppVersion(result.version);
      } catch {
        setAppVersion(null);
      }
    };
    fetchVersion();
  }, []);

  return appVersion;
}
