# ADR-0002: Cloud Runtime Topology

- Status: Proposed
- Date: 2026-02-15
- Owners: Runtime Services
- Related plan: `plans/desktop-mobile-web-unification.md`

## Context

Web and mobile clients need privileged execution capabilities that currently exist only in Electron main process:

- filesystem mutation
- command/process execution
- git operations
- preview lifecycle management

These capabilities require a secure multi-tenant backend architecture with strong isolation, streaming support, and auditability.

## Decision

Adopt a control-plane + worker-plane topology.

### Control plane

Services:

- `api-gateway`: external API entry, auth verification, rate limiting
- `workspace-service`: workspace/project metadata and permissions
- `operation-orchestrator`: validates and queues privileged operations
- `stream-broker`: fan-out for operation events and chat/runtime streams
- `audit-service`: immutable operation/audit log ingestion

### Worker plane

Services:

- `runtime-scheduler`: allocates isolated runtime instances
- `runtime-worker`: executes filesystem/command/preview operations per project
- `git-worker`: executes git operations in isolated workspaces (can be separate or embedded initially)

### Data plane

- relational store for control metadata (workspaces, projects, operations)
- object storage for snapshots/artifacts/log archives
- secret vault for credentials (never persisted in plain metadata tables)

## Isolation and Security Constraints

- Strong tenant isolation at runtime instance boundary.
- Project execution roots are sandboxed per runtime instance.
- Command execution must run with deny-by-default security policies.
- Network egress policy controls by workspace/project tier.
- Every privileged operation must emit an auditable event with actor, scope, and result.

## Streaming and Execution Semantics

- Operations are asynchronous with queued execution where needed.
- Each operation emits typed lifecycle events: `queued`, `started`, `chunk`, `completed`, `failed`.
- Clients reconnect using `correlationId` and replay cursor.
- Idempotency keys prevent duplicate writes on retries.

## Region and Availability Strategy

Initial:

- single region deployment with disaster recovery backups
- active-passive failover for control services

Follow-up:

- multi-region runtime placement
- project region pinning for data residency and latency

## Consequences

### Positive

- Enables web/mobile execution with desktop-comparable capabilities.
- Separates policy/orchestration from execution for safer scaling.
- Supports consistent observability and auditing.

### Negative

- Operational complexity and infra cost increase.
- Requires robust SRE, security, and incident response maturity.
- Cold starts and queue latency can degrade UX if not controlled.

## Alternatives Considered

### A. Single monolithic runtime service

Rejected because it mixes orchestration and execution concerns, making scaling and security controls harder.

### B. Fully serverless per-operation execution only

Rejected because long-lived previews and streaming command output need persistent runtime context.

### C. Desktop relay model (browser/mobile tunnel into user desktop)

Rejected for v1 due to reliability, availability, and connectivity constraints.

## Rollout Plan

1. Build minimal control plane and runtime worker for file ops + command execution.
2. Add stream broker and reliable event replay.
3. Add preview lifecycle management and runtime pooling.
4. Add git worker path and integration-specific execution policies.
5. Introduce multi-region strategy after stable single-region operations.

## Acceptance Criteria

- Cloud project can execute core file and command operations with audited traces.
- Stream reliability meets defined SLOs under target concurrency.
- Isolation and security checks pass internal and external reviews.

## Open Questions

1. Should git run in dedicated workers from day one, or inside runtime workers initially?
2. What runtime class tiers are required for cost/performance segmentation at beta launch?
