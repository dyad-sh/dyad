import { z } from "zod";
import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";
import {
  QueryInvalidationBatchSchema,
  QueryInvalidationEventSchema,
  QueryInvalidationScopeSchema,
  ChatTabOwnershipSchema,
  ChatTabTransferPayloadSchema,
  EntityDisposalEventSchema,
  TabInstanceIdSchema,
  VisibleEntitySchema,
  WindowInterestSchema,
  WindowSessionIdSchema,
} from "../../window_infrastructure/types";

export const windowInfrastructureContracts = {
  bootstrap: defineContract({
    channel: "window-infrastructure:bootstrap",
    input: z.object({
      lastSeenQueryInvalidationEpoch: z.number().int().nonnegative().optional(),
    }),
    output: z.object({
      windowSessionId: WindowSessionIdSchema,
      currentQueryInvalidationEpoch: z.number().int().nonnegative(),
      missedInvalidations: z.array(QueryInvalidationEventSchema),
      recoveryScopes: z.array(QueryInvalidationScopeSchema),
      initialEntity: VisibleEntitySchema.optional(),
      initialChatAppId: z.number().int().positive().optional(),
      mayMigrateLegacyChatTabSession: z.boolean(),
      restorableWindowSessionIds: z.array(WindowSessionIdSchema),
    }),
  }),
  openEntityInNewWindow: defineContract({
    channel: "window-infrastructure:open-entity-in-new-window",
    input: VisibleEntitySchema,
    output: z.object({
      windowSessionId: WindowSessionIdSchema,
    }),
  }),
  beginChatTabTransfer: defineContract({
    channel: "window-infrastructure:begin-chat-tab-transfer",
    input: z.object({
      transferId: z.string().uuid(),
      payload: ChatTabTransferPayloadSchema,
    }),
    output: z.object({ transferId: z.string().uuid() }),
  }),
  adoptChatTabTransfer: defineContract({
    channel: "window-infrastructure:adopt-chat-tab-transfer",
    input: z.object({ transferId: z.string().uuid() }),
    output: ChatTabTransferPayloadSchema,
  }),
  rejectChatTabTransfer: defineContract({
    channel: "window-infrastructure:reject-chat-tab-transfer",
    input: z.object({ transferId: z.string().uuid() }),
    output: z.object({ aborted: z.boolean() }),
  }),
  acknowledgeChatTabTransfer: defineContract({
    channel: "window-infrastructure:acknowledge-chat-tab-transfer",
    input: z.object({ transferId: z.string().uuid() }),
    output: z.void(),
  }),
  confirmSourceChatTabRemoval: defineContract({
    channel: "window-infrastructure:confirm-source-chat-tab-removal",
    input: z.object({
      transferId: z.string().uuid(),
      tabInstanceId: TabInstanceIdSchema,
      chatId: z.number().int().positive(),
    }),
    output: z.void(),
  }),
  focusChat: defineContract({
    channel: "window-infrastructure:focus-chat",
    input: z.object({ chatId: z.number().int().positive() }),
    output: z.object({ windowSessionId: WindowSessionIdSchema }),
  }),
  setFocused: defineContract({
    channel: "window-infrastructure:set-focused",
    input: z.void(),
    output: z.void(),
  }),
  setVisibleEntities: defineContract({
    channel: "window-infrastructure:set-visible-entities",
    input: z.array(VisibleEntitySchema),
    output: z.void(),
  }),
  setChatTabOwnership: defineContract({
    channel: "window-infrastructure:set-chat-tab-ownership",
    input: z.array(ChatTabOwnershipSchema).max(100),
    output: z.void(),
  }),
  attachInterest: defineContract({
    channel: "window-infrastructure:attach-interest",
    input: WindowInterestSchema,
    output: z.void(),
  }),
  detachInterest: defineContract({
    channel: "window-infrastructure:detach-interest",
    input: WindowInterestSchema,
    output: z.void(),
  }),
} as const;

export const windowInfrastructureEvents = {
  queryInvalidations: defineEvent({
    channel: "window:query-invalidations",
    payload: QueryInvalidationBatchSchema,
  }),
  entityDisposed: defineEvent({
    channel: "window:entity-disposed",
    payload: EntityDisposalEventSchema,
  }),
  removeTransferredChatTab: defineEvent({
    channel: "window:chat-tab-transfer-remove-source",
    payload: z.object({
      transferId: z.string().uuid(),
      tabInstanceId: TabInstanceIdSchema,
      chatId: z.number().int().positive(),
    }),
  }),
  navigateToChat: defineEvent({
    channel: "window:navigate-to-chat",
    payload: z.object({
      chatId: z.number().int().positive(),
      appId: z.number().int().positive(),
    }),
  }),
} as const;

export const windowInfrastructureClient = createClient(
  windowInfrastructureContracts,
);
export const windowInfrastructureEventClient = createEventClient(
  windowInfrastructureEvents,
);
