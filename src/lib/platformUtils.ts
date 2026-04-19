import { useState } from "react";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function detectIsMac(): boolean {
  const nav = navigator as NavigatorWithUserAgentData;
  if ("userAgentData" in nav && nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toLowerCase().includes("mac");
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function useIsMac(): boolean {
  const [isMac] = useState(() => detectIsMac());

  return isMac;
}
