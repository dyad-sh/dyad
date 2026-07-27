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
  EntityDisposalEventSchema,
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
    }),
  }),
  openEntityInNewWindow: defineContract({
    channel: "window-infrastructure:open-entity-in-new-window",
    input: VisibleEntitySchema,
    output: z.object({
      windowSessionId: WindowSessionIdSchema,
    }),
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
} as const;

export const windowInfrastructureClient = createClient(
  windowInfrastructureContracts,
);
export const windowInfrastructureEventClient = createEventClient(
  windowInfrastructureEvents,
);
