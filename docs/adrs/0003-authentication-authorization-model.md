# ADR-0003: Authentication and Authorization Model

- Status: Proposed
- Date: 2026-02-15
- Owners: Platform Security
- Related plan: `plans/desktop-mobile-web-unification.md`

## Context

A multi-platform Coney requires remote privileged execution. This introduces security requirements not present in desktop-only local mode:

- user identity across devices
- workspace-level access control
- operation-level authorization and consent
- secure storage and use of provider secrets
- end-to-end auditing for sensitive actions

## Decision

Adopt an identity-first model using OIDC authentication, workspace RBAC authorization, and policy-gated privileged operations.

## Authentication Model

- Use OIDC/OAuth2 for user authentication across desktop/web/mobile.
- Use short-lived access tokens and rotatable refresh tokens.
- Desktop, web, and mobile clients use platform-appropriate secure token storage.
- Service-to-service communication uses mTLS and signed service identities.

## Authorization Model

### Workspace RBAC

Base roles:

- `owner`
- `admin`
- `editor`
- `viewer`

Permissions are evaluated against:

- workspace
- project
- operation type
- host capability

### Operation policy layer

In addition to RBAC, high-risk operations require policy checks:

- destructive file deletes
- destructive SQL
- force push/history rewrite
- shell commands outside safe policy

Policy outcomes:

- allow
- require user approval
- deny

## Secrets Model

- Provider credentials stored in centralized secret vault.
- Secrets encrypted with envelope encryption (KMS-managed keys).
- Secrets scoped minimally (workspace/project/provider).
- Runtime workers receive short-lived scoped secret grants, not raw long-lived credentials.
- Secret access events are fully audited.

## Audit and Compliance Requirements

Every privileged operation must log:

- actor id
- workspace/project scope
- operation type
- policy decision
- result status
- correlation id
- timestamp

Audit logs must be immutable and queryable for incident response.

## Consequences

### Positive

- Unified identity and access model across all platforms.
- Defense-in-depth for privileged cloud operations.
- Clear compliance and forensic posture.

### Negative

- Higher implementation complexity than simple API key auth.
- Requires policy engine ownership and ongoing governance.
- Increased onboarding complexity for workspace/admin concepts.

## Alternatives Considered

### A. API key only auth for clients

Rejected due to poor revocation, weak identity semantics, and high leakage risk.

### B. RBAC only without operation policy layer

Rejected because role permissions alone are too coarse for high-risk operations.

### C. Store all secrets client-side and forward on demand

Rejected because it increases exposure and complicates cross-device continuity.

## Rollout Plan

1. Implement OIDC auth + workspace/session primitives.
2. Introduce baseline RBAC enforcement across API endpoints.
3. Add operation policy engine for high-impact actions.
4. Migrate provider secrets to centralized vault and deprecate legacy paths.
5. Add immutable audit log store and admin audit views.

## Acceptance Criteria

- All cloud API operations require authenticated identity and scoped authorization.
- High-risk operations enforce policy with approval/deny semantics.
- Secret access is scoped, short-lived, and auditable.
- Security testing validates token, RBAC, and policy boundaries.

## Open Questions

1. Do we need custom enterprise SSO/SAML in beta or post-GA?
2. What is the default approval policy for non-destructive command execution?
3. What audit retention period is required by target compliance commitments?
