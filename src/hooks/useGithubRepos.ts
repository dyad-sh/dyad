import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";

export function useGithubRepos({ enabled }: { enabled: boolean }) {
  const { settings } = useSettings();
  // Scope by account so a different connected GitHub account doesn't reuse the
  // previous account's cached repo list.
  const account = settings?.githubUser?.email ?? null;
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.github.repos(account),
    queryFn: () => ipc.github.listRepos(),
    enabled,
    meta: { showErrorToast: true },
  });

  return {
    repos: data ?? [],
    loading: isLoading,
    error,
  };
}

export function useDyadGithubRepos({ enabled }: { enabled: boolean }) {
  const { settings } = useSettings();
  // Scope by account so a different connected GitHub account doesn't reuse the
  // previous account's cached repo list.
  const account = settings?.githubUser?.email ?? null;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.github.dyadRepos(account),
    queryFn: () => ipc.github.listDyadRepos(),
    enabled,
    // Discovery runs an AI_RULES.md heuristic that can fan out many GitHub
    // requests, so avoid re-scanning on every tab open / window refocus.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // No showErrorToast: the tab renders a first-class inline error + Retry
    // surface for load failures, so a global toast would be redundant noise.
  });

  return {
    repos: data ?? [],
    loading: isLoading,
    error,
    refetch,
  };
}
