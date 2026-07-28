import type { HistoricalFailureShape } from "./machine_conformance";

export type FindingEnforcement =
  | { readonly kind: "api-prohibition"; readonly id: string }
  | {
      readonly kind: "conformance-scenario";
      readonly scenario: HistoricalFailureShape;
    }
  | {
      readonly kind: "domain-invariant";
      readonly id: string;
      readonly focusedTest: string;
    };

export interface FoundationFinding {
  readonly id: string;
  readonly pr: number;
  readonly discussionId: number;
  readonly enforcement: FindingEnforcement;
}

const scenario = (value: HistoricalFailureShape): FindingEnforcement => ({
  kind: "conformance-scenario",
  scenario: value,
});

const prohibition = (id: string): FindingEnforcement => ({
  kind: "api-prohibition",
  id,
});

const invariant = (id: string, focusedTest: string): FindingEnforcement => ({
  kind: "domain-invariant",
  id,
  focusedTest,
});

function finding(
  pr: number,
  discussionId: number,
  enforcement: FindingEnforcement,
): FoundationFinding {
  return {
    id: `${pr}-${discussionId}`,
    pr,
    discussionId,
    enforcement,
  };
}

/**
 * Exact review-thread inventory for the 46 foundation findings in #4097–#4106.
 * Repeated review comments intentionally share enforcement shapes.
 */
export const FOUNDATION_FINDINGS = [
  finding(4098, 3649631430, scenario("disposal-with-unresolved-work")),
  finding(4099, 3649639006, prohibition("explicit-key-intent-relationship")),
  finding(4099, 3649660218, prohibition("explicit-key-intent-relationship")),
  finding(
    4099,
    3649660220,
    invariant("projection-key-identity", "src/app_run/transport.test.ts"),
  ),
  finding(4099, 3649673766, prohibition("explicit-key-intent-relationship")),
  finding(4100, 3649652336, scenario("construction-disposal-recreation")),
  finding(4100, 3649682002, scenario("retention-deadline-refresh")),
  finding(4100, 3649695510, prohibition("host-owned-event-ingress")),
  finding(4100, 3649695512, scenario("retention-deadline-refresh")),
  finding(4100, 3649709911, prohibition("host-owned-event-ingress")),
  finding(4100, 3649739209, scenario("construction-disposal-recreation")),
  finding(4100, 3649813313, scenario("activation-reentry")),
  finding(4100, 3649813315, scenario("construction-disposal-recreation")),
  finding(4100, 3649813316, scenario("construction-disposal-recreation")),
  finding(4100, 3649813317, scenario("retention-deadline-refresh")),
  finding(4100, 3649848884, scenario("construction-disposal-recreation")),
  finding(4100, 3649889616, scenario("construction-disposal-recreation")),
  finding(
    4100,
    3649889618,
    invariant(
      "applied-requires-committed-snapshot",
      "src/state_machines/dispatcher.test.ts",
    ),
  ),
  finding(4100, 3649898974, scenario("activation-reentry")),
  finding(4101, 3649653015, scenario("abort-terminal-settlement")),
  finding(
    4101,
    3649679630,
    invariant(
      "readiness-is-invocation-correlated",
      "src/ipc/services/app_runtime_service.test.ts",
    ),
  ),
  finding(4101, 3649679631, scenario("abort-terminal-settlement")),
  finding(4101, 3649682382, scenario("abort-terminal-settlement")),
  finding(4102, 3649675270, scenario("bootstrap-generation-regression")),
  finding(4102, 3649675272, scenario("unsubscribe-during-bootstrap")),
  finding(4102, 3649701149, scenario("bootstrap-generation-regression")),
  finding(4102, 3649701151, scenario("bootstrap-generation-regression")),
  finding(
    4102,
    3649705259,
    invariant(
      "recovery-history-is-bounded",
      "src/window_infrastructure/main/query_invalidation_bus.test.ts",
    ),
  ),
  finding(4104, 3649875422, scenario("delivery-projection-divergence")),
  finding(
    4104,
    3649875424,
    invariant(
      "origin-invalidation-contract",
      "src/window_infrastructure/renderer_query_invalidation.test.ts",
    ),
  ),
  finding(
    4104,
    3649875426,
    invariant(
      "fanout-isolates-destination-failure",
      "src/window_infrastructure/main/high_volume_interests.test.ts",
    ),
  ),
  finding(4104, 3649921398, scenario("delivery-projection-divergence")),
  finding(
    4104,
    3649921400,
    invariant(
      "origin-invalidation-contract",
      "src/window_infrastructure/renderer_query_invalidation.test.ts",
    ),
  ),
  finding(
    4104,
    3649921402,
    invariant(
      "origin-invalidation-contract",
      "src/window_infrastructure/renderer_query_invalidation.test.ts",
    ),
  ),
  finding(4105, 3649973570, scenario("post-authorization-actor-window-change")),
  finding(4105, 3649973571, scenario("post-authorization-actor-window-change")),
  finding(4105, 3649973572, scenario("unresolved-receipt-under-pressure")),
  finding(4105, 3649996550, scenario("error-classification-collapse")),
  finding(4105, 3649996552, scenario("post-authorization-actor-window-change")),
  finding(4105, 3650473473, scenario("unsubscribe-during-bootstrap")),
  finding(4105, 3650531270, scenario("error-classification-collapse")),
  finding(4105, 3650581476, prohibition("bounded-envelope-before-codec")),
  finding(4105, 3650581479, scenario("error-classification-collapse")),
  finding(4105, 3650647895, prohibition("dispatch-requires-subscription")),
  finding(4106, 3650523429, scenario("stale-release")),
  finding(4106, 3650583900, scenario("refresh-acquires-ownership")),
] as const satisfies readonly FoundationFinding[];
