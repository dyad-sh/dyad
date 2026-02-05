import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import type {
  StorageBucket,
  ListStorageObjectsResult,
} from "@/ipc/types/supabase";

interface UseStorageConnectionParams {
  projectId: string | null;
  organizationSlug: string | null;
}

export function useStorageBuckets({
  projectId,
  organizationSlug,
}: UseStorageConnectionParams) {
  return useQuery<StorageBucket[], Error>({
    queryKey: queryKeys.supabase.storageBuckets({
      projectId: projectId ?? "",
      organizationSlug,
    }),
    queryFn: () =>
      ipc.supabase.listStorageBuckets({
        projectId: projectId!,
        organizationSlug,
      }),
    enabled: !!projectId,
  });
}

export function useStorageObjects({
  projectId,
  organizationSlug,
  bucketId,
  prefix,
  limit,
  offset,
}: UseStorageConnectionParams & {
  bucketId: string | null;
  prefix?: string;
  limit: number;
  offset: number;
}) {
  return useQuery<ListStorageObjectsResult, Error>({
    queryKey: queryKeys.supabase.storageObjects({
      projectId: projectId ?? "",
      organizationSlug,
      bucketId: bucketId ?? "",
      prefix,
      limit,
      offset,
    }),
    queryFn: () =>
      ipc.supabase.listStorageObjects({
        projectId: projectId!,
        organizationSlug,
        bucketId: bucketId!,
        prefix,
        limit,
        offset,
      }),
    enabled: !!projectId && !!bucketId,
  });
}
