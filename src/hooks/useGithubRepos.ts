import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useGithubRepos({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.github.repos,
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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.github.dyadRepos,
    queryFn: () => ipc.github.listDyadRepos(),
    enabled,
    // Discovery runs an AI_RULES.md heuristic that can fan out many GitHub
    // requests, so avoid re-scanning on every tab open / window refocus.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    meta: { showErrorToast: true },
  });

  return {
    repos: data ?? [],
    loading: isLoading,
    error,
    refetch,
  };
}
