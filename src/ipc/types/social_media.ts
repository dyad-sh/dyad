import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Social Media Schemas (Facebook + X posting, content calendar/planner)
// =============================================================================

export const SocialPlatformSchema = z.enum(["facebook", "x"]);
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const SocialPostStatusSchema = z.enum([
  "draft",
  "scheduled",
  "posting",
  "posted",
  "failed",
]);
export type SocialPostStatus = z.infer<typeof SocialPostStatusSchema>;

/** A post in the content planner (drafts, scheduled, and published copies). */
export const SocialPostSchema = z.object({
  id: z.string(),
  platform: SocialPlatformSchema,
  content: z.string(),
  /** Generated/attached image as a base64 data URL. */
  image: z.string().nullish(),
  /** The user prompt the post was generated from. */
  prompt: z.string().nullish(),
  status: SocialPostStatusSchema,
  /** Epoch ms when the post should be (or was) scheduled to go out. */
  scheduledFor: z.number().nullish(),
  /** Epoch ms when the post was published. */
  postedAt: z.number().nullish(),
  /** Platform-side id of the published post. */
  externalId: z.string().nullish(),
  /** Link to the published post. */
  externalUrl: z.string().nullish(),
  /** Last publish error, when status is "failed". */
  error: z.string().nullish(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SocialPost = z.infer<typeof SocialPostSchema>;

export const CreateSocialPostParamsSchema = z.object({
  platform: SocialPlatformSchema,
  content: z.string().min(1).max(10_000),
  image: z.string().nullish(),
  prompt: z.string().nullish(),
  /** Omit for a draft; set to schedule automatic publishing. */
  scheduledFor: z.number().nullish(),
});
export type CreateSocialPostParams = z.infer<
  typeof CreateSocialPostParamsSchema
>;

export const UpdateSocialPostParamsSchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(10_000).optional(),
  image: z.string().nullish(),
  scheduledFor: z.number().nullish(),
  /** Allowed manual transitions: draft <-> scheduled. */
  status: z.enum(["draft", "scheduled"]).optional(),
});
export type UpdateSocialPostParams = z.infer<
  typeof UpdateSocialPostParamsSchema
>;

/** Connection status safe to expose to the renderer (no secrets). */
export const SocialConnectionsStatusSchema = z.object({
  facebook: z.object({
    connected: z.boolean(),
    pageId: z.string().optional(),
    pageName: z.string().optional(),
    connectedAt: z.number().optional(),
  }),
  x: z.object({
    connected: z.boolean(),
    username: z.string().optional(),
    connectedAt: z.number().optional(),
  }),
});
export type SocialConnectionsStatus = z.infer<
  typeof SocialConnectionsStatusSchema
>;

export const ConnectFacebookParamsSchema = z.object({
  pageId: z.string().min(1),
  pageAccessToken: z.string().min(1),
});
export type ConnectFacebookParams = z.infer<typeof ConnectFacebookParamsSchema>;

export const ConnectXParamsSchema = z.object({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  accessToken: z.string().min(1),
  accessTokenSecret: z.string().min(1),
});
export type ConnectXParams = z.infer<typeof ConnectXParamsSchema>;

export const GeneratePostCopyParamsSchema = z.object({
  platform: SocialPlatformSchema,
  prompt: z.string().min(1).max(4000),
  includeImage: z.boolean().optional(),
});
export type GeneratePostCopyParams = z.infer<
  typeof GeneratePostCopyParamsSchema
>;

export const GeneratePostCopyResponseSchema = z.object({
  /** The post copy, ready to publish on the selected platform. */
  content: z.string(),
  /** An image-generation prompt derived from the user's idea. */
  imagePrompt: z.string(),
});
export type GeneratePostCopyResponse = z.infer<
  typeof GeneratePostCopyResponseSchema
>;

// =============================================================================
// Social Media Contracts
// =============================================================================

export const socialMediaContracts = {
  getConnections: defineContract({
    channel: "social-media:get-connections",
    input: z.void(),
    output: SocialConnectionsStatusSchema,
  }),
  connectFacebook: defineContract({
    channel: "social-media:connect-facebook",
    input: ConnectFacebookParamsSchema,
    output: SocialConnectionsStatusSchema,
  }),
  connectX: defineContract({
    channel: "social-media:connect-x",
    input: ConnectXParamsSchema,
    output: SocialConnectionsStatusSchema,
  }),
  disconnect: defineContract({
    channel: "social-media:disconnect",
    input: z.object({ platform: SocialPlatformSchema }),
    output: SocialConnectionsStatusSchema,
  }),
  listPosts: defineContract({
    channel: "social-media:list-posts",
    input: z.void(),
    output: z.array(SocialPostSchema),
  }),
  createPost: defineContract({
    channel: "social-media:create-post",
    input: CreateSocialPostParamsSchema,
    output: SocialPostSchema,
  }),
  updatePost: defineContract({
    channel: "social-media:update-post",
    input: UpdateSocialPostParamsSchema,
    output: SocialPostSchema,
  }),
  deletePost: defineContract({
    channel: "social-media:delete-post",
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() }),
  }),
  generatePostCopy: defineContract({
    channel: "social-media:generate-post-copy",
    input: GeneratePostCopyParamsSchema,
    output: GeneratePostCopyResponseSchema,
  }),
  publishPost: defineContract({
    channel: "social-media:publish-post",
    input: z.object({ id: z.string() }),
    output: SocialPostSchema,
  }),
} as const;

// =============================================================================
// Social Media Client
// =============================================================================

export const socialMediaClient = createClient(socialMediaContracts);
