import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

// Get a callback to retrieve the current chat ID from the router path and search params.

export function useCurrentChatIdFromRoute(): () => number | undefined {
  const router = useRouter();

  return useCallback(() => {
    if (!router.state.location.pathname.startsWith("/chat")) {
      return undefined;
    }

    const rawId = (router.state.location.search as Record<string, unknown>).id;
    const parsedId =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string"
          ? Number(rawId)
          : NaN;

    return Number.isInteger(parsedId) && parsedId > 0 ? parsedId : undefined;
  }, [router]);
}
