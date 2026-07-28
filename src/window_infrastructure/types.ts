import { z } from "zod";

declare const windowSessionIdBrand: unique symbol;
declare const tabInstanceIdBrand: unique symbol;

export type WindowSessionId = string & {
  readonly [windowSessionIdBrand]: true;
};
export type TabInstanceId = string & {
  readonly [tabInstanceIdBrand]: true;
};

export const WindowSessionIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as WindowSessionId);
export const TabInstanceIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as TabInstanceId);

export const VisibleEntitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), id: z.number().int().positive() }),
  z.object({ kind: z.literal("chat"), id: z.number().int().positive() }),
]);
export type VisibleEntity = z.infer<typeof VisibleEntitySchema>;

export const PresentationEffectSchema = z.enum([
  "operation-toast",
  "navigation",
  "inline-shared-error",
  "user-input",
  "important-completion",
  "ordinary",
]);
export type PresentationEffect = z.infer<typeof PresentationEffectSchema>;

export interface PresentationRouteRequest {
  effect: PresentationEffect;
  initiatorWindowSessionId?: WindowSessionId;
  entity?: VisibleEntity;
}

export const ScreenshotCapabilitySchema = z.object({
  kind: z.literal("screenshot"),
  appId: z.number().int().positive(),
  iframeEpoch: z.number().int().nonnegative(),
});
export type ScreenshotCapability = z.infer<typeof ScreenshotCapabilitySchema>;

export type CapabilityLossPolicy = "retry" | "settle";

export interface WindowCapabilityRequest {
  kind: "screenshot";
  appId: number;
  lossPolicy: CapabilityLossPolicy;
  preferredWindowSessionId?: WindowSessionId;
}

export type CapabilityLeaseLossReason =
  | "window-destroyed"
  | "iframe-epoch-changed"
  | "capability-withdrawn";

export interface WindowCapabilityLease {
  leaseId: string;
  kind: "screenshot";
  appId: number;
  holderWindowSessionId: WindowSessionId;
  iframeEpoch: number;
  lossPolicy: CapabilityLossPolicy;
  isActive(): boolean;
  lossReason(): CapabilityLeaseLossReason | null;
  shouldRetry(): boolean;
}

export const QueryInvalidationScopeSchema = z.discriminatedUnion("family", [
  z.object({ family: z.literal("apps") }),
  z.object({ family: z.literal("chats") }),
  z.object({ family: z.literal("app-collections") }),
  z.object({ family: z.literal("media") }),
  z.object({ family: z.literal("token-count") }),
  z.object({ family: z.literal("user-budget") }),
  z.object({ family: z.literal("free-agent-quota") }),
  z.object({ family: z.literal("free-model-quota") }),
  z.object({
    family: z.literal("app"),
    appId: z.number().int().positive(),
  }),
  z.object({
    family: z.literal("versions"),
    appId: z.number().int().positive().optional(),
  }),
  z.object({
    family: z.literal("branches"),
    appId: z.number().int().positive().optional(),
  }),
  z.object({
    family: z.literal("problems"),
    appId: z.number().int().positive().optional(),
  }),
  z.object({
    family: z.literal("uncommitted-files"),
    appId: z.number().int().positive().optional(),
  }),
  z.object({
    family: z.literal("chat"),
    chatId: z.number().int().positive(),
  }),
  z.object({
    family: z.literal("provider-status"),
    provider: z.enum(["github", "supabase", "neon"]),
  }),
  z.object({ family: z.literal("mcp-servers") }),
  z.object({ family: z.literal("mcp-catalog") }),
  z.object({
    family: z.literal("mcp-tools"),
    serverId: z.number().int().positive().optional(),
  }),
]);
export type QueryInvalidationScope = z.infer<
  typeof QueryInvalidationScopeSchema
>;

export const QueryInvalidationEventSchema = z.object({
  epoch: z.number().int().positive(),
  scopes: z.array(QueryInvalidationScopeSchema).min(1),
  originWindowSessionId: WindowSessionIdSchema.optional(),
  originHandledScopes: z.array(QueryInvalidationScopeSchema).optional(),
});
export type QueryInvalidationEvent = z.infer<
  typeof QueryInvalidationEventSchema
>;

export const QueryInvalidationBatchSchema = z.object({
  invalidations: z.array(QueryInvalidationEventSchema).min(1),
  recoveryScopes: z.array(QueryInvalidationScopeSchema),
});
export type QueryInvalidationBatch = z.infer<
  typeof QueryInvalidationBatchSchema
>;

export const WindowInterestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("app-output"),
    appId: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("chat-chunk"),
    chatId: z.number().int().positive(),
  }),
]);
export type WindowInterest = z.infer<typeof WindowInterestSchema>;

export const EntityDisposalEventSchema = z.object({
  epoch: z.number().int().positive(),
  entity: VisibleEntitySchema,
});
export type EntityDisposalEvent = z.infer<typeof EntityDisposalEventSchema>;

export function visibleEntityKey(entity: VisibleEntity): string {
  return `${entity.kind}:${entity.id}`;
}

export function windowInterestKey(interest: WindowInterest): string {
  return interest.kind === "app-output"
    ? `${interest.kind}:${interest.appId}`
    : `${interest.kind}:${interest.chatId}`;
}

export function queryInvalidationScopeKey(
  scope: QueryInvalidationScope,
): string {
  switch (scope.family) {
    case "app":
    case "versions":
    case "branches":
    case "problems":
    case "uncommitted-files":
      return `${scope.family}:${scope.appId ?? "*"}`;
    case "chat":
      return `${scope.family}:${scope.chatId}`;
    case "provider-status":
      return `${scope.family}:${scope.provider}`;
    case "mcp-tools":
      return `${scope.family}:${scope.serverId ?? "*"}`;
    default:
      return scope.family;
  }
}
