import type { PresentationEndpoint } from "./safe_sender";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import type { QueryInvalidationScope } from "@/window_infrastructure/types";

export function publishQueryInvalidations(
  scopes: readonly QueryInvalidationScope[],
  origin?: PresentationEndpoint,
): void {
  queryInvalidationBus.publish(
    scopes,
    origin === undefined ? {} : { originEndpoint: origin },
  );
}
