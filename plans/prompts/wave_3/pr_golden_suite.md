# Golden single-window characterization suite (MUST land before any Phase B production wiring)

Implement the "Golden single-window characterization suite" from
plans/cleanup-state-machines.md ("Verification strategy → Single-window
protection"). The plan wins over this prompt. This is test-only — zero
production changes — and it MUST merge before B1 or any audit-rewiring PR
touches a production flow, because its entire value is capturing behavior
BEFORE rerouting begins.

Scope — a named collection (e.g. src/**tests**/golden_single_window/ or
the repo's convention for suites), mostly assembled from assertions that
already exist scattered across suites, promoted and gap-filled:

1. Toast/notification delivery per flow: for each production flow that
   emits a toast, navigation, or OS notification (stream completion,
   image-generation settlement, version-preview recovery, package-manager
   warning, consent prompts), assert what fires, once, and where. These
   become the diff-baseline for the presentation router.
2. Invalidation-triggered refetch counts per mutation: for the main
   mutation paths (chat create/update, app create/delete, version
   checkout/restore, branch ops), assert which query families invalidate
   and HOW MANY refetches occur — the double-invalidation regression
   (origin-local + broadcast without dedup) shows up here as a count
   diff.
3. Console first-line-after-subscribe timing: start an app, subscribe
   immediately, first output line is present (the attach/detach race
   baseline for interest-keyed fan-out).
4. Quit/reload teardown order: window reload and app quit dispose
   window-local machines and release resources in the currently-correct
   order (baseline for the pagehide/disposal split). Reuse the disposal
   conformance helpers.
5. Tab session restore from a captured REAL session blob (check one into
   fixtures): assert restore produces the same tabs/selection (baseline
   for the per-window schema migration).

Requirements: deterministic (fake clocks/IdSources per the kernel test
kit); each assertion documents which future rewiring PR it protects
(router / invalidation channel / fan-out / pagehide split / tab schema);
CI runs it in the normal unit/integration pass; a one-line note in the
plan's Single-window protection section marks it landed with the PR
number.

Verify: typecheck, full test run, lint; confirm the suite fails loudly
when one baseline is deliberately broken (temporarily flip one assertion
to prove signal, then restore). Branch cleanup-golden-suite; /pr-push;
update plan status.
