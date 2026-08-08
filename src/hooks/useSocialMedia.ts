import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import type {
  ConnectFacebookParams,
  ConnectXParams,
  CreateSocialPostParams,
  GeneratePostCopyParams,
  SocialConnectionsStatus,
  SocialPlatform,
  UpdateSocialPostParams,
} from "@/ipc/types/social_media";
import { queryKeys } from "@/lib/queryKeys";

/** Connection status for Facebook + X (no secrets cross the bridge). */
export function useSocialConnections() {
  const queryClient = useQueryClient();

  const connectionsQuery = useQuery({
    queryKey: queryKeys.socialMedia.connections,
    queryFn: () => ipc.socialMedia.getConnections(),
  });

  const setConnections = (status: SocialConnectionsStatus) => {
    queryClient.setQueryData(queryKeys.socialMedia.connections, status);
  };

  const connectFacebookMutation = useMutation({
    mutationFn: (params: ConnectFacebookParams) =>
      ipc.socialMedia.connectFacebook(params),
    onSuccess: setConnections,
  });

  const connectXMutation = useMutation({
    mutationFn: (params: ConnectXParams) => ipc.socialMedia.connectX(params),
    onSuccess: setConnections,
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: SocialPlatform) =>
      ipc.socialMedia.disconnect({ platform }),
    onSuccess: setConnections,
  });

  return {
    connections: connectionsQuery.data,
    isLoading: connectionsQuery.isLoading,
    connectFacebook: connectFacebookMutation.mutateAsync,
    isConnectingFacebook: connectFacebookMutation.isPending,
    connectX: connectXMutation.mutateAsync,
    isConnectingX: connectXMutation.isPending,
    disconnect: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}

/** Content planner posts + mutations (create, update, delete, publish). */
export function useSocialPosts() {
  const queryClient = useQueryClient();

  const postsQuery = useQuery({
    queryKey: queryKeys.socialMedia.posts,
    queryFn: () => ipc.socialMedia.listPosts(),
    // The main-process scheduler publishes due posts in the background;
    // keep the calendar fresh while the page is open.
    refetchInterval: 30_000,
  });

  const invalidatePosts = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.socialMedia.posts });

  const createPostMutation = useMutation({
    mutationFn: (params: CreateSocialPostParams) =>
      ipc.socialMedia.createPost(params),
    onSuccess: invalidatePosts,
  });

  const updatePostMutation = useMutation({
    mutationFn: (params: UpdateSocialPostParams) =>
      ipc.socialMedia.updatePost(params),
    onSuccess: invalidatePosts,
  });

  const deletePostMutation = useMutation({
    mutationFn: (id: string) => ipc.socialMedia.deletePost({ id }),
    onSuccess: invalidatePosts,
  });

  const publishPostMutation = useMutation({
    mutationFn: (id: string) => ipc.socialMedia.publishPost({ id }),
    onSettled: invalidatePosts,
  });

  return {
    posts: postsQuery.data ?? [],
    isLoading: postsQuery.isLoading,
    refetch: postsQuery.refetch,
    createPost: createPostMutation.mutateAsync,
    isCreating: createPostMutation.isPending,
    updatePost: updatePostMutation.mutateAsync,
    isUpdating: updatePostMutation.isPending,
    deletePost: deletePostMutation.mutateAsync,
    isDeleting: deletePostMutation.isPending,
    publishPost: publishPostMutation.mutateAsync,
    isPublishing: publishPostMutation.isPending,
  };
}

/** AI copy generation for a platform-specific post + image prompt. */
export function useGeneratePostCopy() {
  const mutation = useMutation({
    mutationFn: (params: GeneratePostCopyParams) =>
      ipc.socialMedia.generatePostCopy(params),
  });
  return {
    generateCopy: mutation.mutateAsync,
    isGenerating: mutation.isPending,
  };
}
