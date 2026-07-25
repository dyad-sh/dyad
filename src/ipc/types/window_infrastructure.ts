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
  VisibleEntitySchema,
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
} as const;

export const windowInfrastructureEvents = {
  queryInvalidations: defineEvent({
    channel: "window:query-invalidations",
    payload: QueryInvalidationBatchSchema,
  }),
} as const;

export const windowInfrastructureClient = createClient(
  windowInfrastructureContracts,
);
export const windowInfrastructureEventClient = createEventClient(
  windowInfrastructureEvents,
);
