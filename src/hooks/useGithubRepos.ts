import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import type { DyadGithubRepo } from "@/ipc/types/github";

export function useGithubRepos({ enabled }: { enabled: boolean }) {
  const { settings } = useSettings();
  // Scope by account so a different connected GitHub account doesn't reuse the
  // previous account's cached repo list. Key off the access token rather than
  // githubUser.email: the token is guaranteed present whenever authenticated
  // and is unique per account, whereas email is populated only lazily and can
  // be null while authenticated — which would collapse distinct accounts onto a
  // shared `null` bucket and leak the prior account's private repo names.
  const account = settings?.githubAccessToken?.value ?? null;
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
  const queryClient = useQueryClient();
  // Scope by account so a different connected GitHub account doesn't reuse the
  // previous account's cached repo list. Key off the access token rather than
  // githubUser.email: the token is guaranteed present whenever authenticated
  // and is unique per account, whereas email is populated only lazily and can
  // be null while authenticated — which would collapse distinct accounts onto a
  // shared `null` bucket and leak the prior account's private repo names.
  const account = settings?.githubAccessToken?.value ?? null;
  const queryKey = queryKeys.github.dyadRepos(account);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => ipc.github.listDyadRepos(),
    enabled,
    // Discovery runs an AI_RULES.md heuristic that can fan out many GitHub
    // requests, so avoid re-scanning on every tab open / window refocus.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // No showErrorToast: the tab renders a first-class inline error + Retry
    // surface for load failures, so a global toast would be redundant noise.
  });

  // Optimistically flag just-imported repos as imported in the cache instead of
  // triggering a full refetch. A refetch re-runs the expensive discovery scan
  // (topic search + AI_RULES.md fan-out) right after a bulk import, doubling the
  // request load when the token is most strained; it also briefly re-offers the
  // repos we just cloned (cache still says alreadyImported:false), which lets a
  // second click clone them again. Marking them here keeps the list correct
  // without any extra GitHub requests.
  const markImported = useCallback(
    (fullNames: string[]) => {
      if (fullNames.length === 0) return;
      const imported = new Set(fullNames);
      queryClient.setQueryData<DyadGithubRepo[]>(
        queryKeys.github.dyadRepos(account),
        (prev) =>
          prev?.map((repo) =>
            imported.has(repo.full_name)
              ? { ...repo, alreadyImported: true }
              : repo,
          ),
      );
    },
    [queryClient, account],
  );

  return {
    repos: data ?? [],
    loading: isLoading,
    error,
    refetch,
    markImported,
  };
}
