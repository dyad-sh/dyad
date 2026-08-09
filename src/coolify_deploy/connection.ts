/**
 * An app's Coolify record, as a shape that cannot hold a contradiction.
 *
 * This began as seven nullable columns on `apps` written from twenty-eight
 * places, each deciding which subset to clear, and nearly every bug here was
 * the same one: cleared the application id but not the URL, cleared the URL
 * but not the deploy time, kept an application belonging to a server the app
 * had already left. It is a row in `coolify_app_connections` now, so a
 * connection either exists or does not, and the server, project and
 * environment are NOT NULL — the database will not hold half of one either.
 *
 * A change is applied by `applyCoolifyConnectionChange` and turned into a row
 * by `coolifyConnectionRow`, which returns null for a connection that should
 * not exist. There is no way to write a subset of a row, so there is no way
 * to write an inconsistent one.
 *
 * Pure by design: no database, no clock, no Electron. The caller supplies the
 * current record and the time.
 */

/** Where an app stands with Coolify, independent of whether a token exists. */
export type CoolifyConnectionState =
  | { kind: "none" }
  /** A server and project are chosen; nothing exists in Coolify yet. */
  | {
      kind: "configured";
      serverUuid: string;
      projectUuid: string;
      environmentName: string;
      domain: string | null;
    }
  /** An application exists in Coolify but has never finished a deploy. */
  | {
      kind: "provisioned";
      serverUuid: string;
      projectUuid: string;
      environmentName: string;
      domain: string | null;
      applicationUuid: string;
    }
  /** An application exists and is reachable at a known address. */
  | {
      kind: "deployed";
      serverUuid: string;
      projectUuid: string;
      environmentName: string;
      domain: string | null;
      applicationUuid: string;
      appUrl: string | null;
      lastDeployedAt: Date;
    };

export type CoolifyConnectionChange =
  /** The user saved the connection form. */
  | {
      type: "CONFIGURED";
      serverUuid: string;
      projectUuid: string;
      environmentName: string;
      domain: string | null;
    }
  /** The user disconnected this app, or its instance was replaced. */
  | { type: "DETACHED" }
  /** The pipeline created or adopted an application in Coolify. */
  | { type: "APPLICATION_RESOLVED"; applicationUuid: string }
  /**
   * The recorded application is no longer this app's, with none to replace it
   * yet — Coolify answered 404 for it, or it clones with a stale key and is
   * being replaced. It may still exist on the server in the second case.
   */
  | { type: "APPLICATION_GONE" }
  /** The pipeline finished and the app is reachable. */
  | { type: "DEPLOY_SUCCEEDED"; appUrl: string | null; at: Date };

/** The stored row, minus the app id its caller already knows. */
export interface CoolifyConnectionRow {
  serverUuid: string;
  projectUuid: string;
  environmentName: string;
  applicationUuid: string | null;
  domain: string | null;
  appUrl: string | null;
  lastDeployedAt: Date | null;
}

/**
 * Reads a stored row back into a state.
 *
 * No row is no connection. A row can still hold a combination the union does
 * not describe — an address recorded without a deploy time, say — so it
 * degrades to the strongest state its fields actually support rather than
 * being trusted.
 */
export function coolifyConnectionFromRow(
  row: CoolifyConnectionRow | null | undefined,
): CoolifyConnectionState {
  if (!row) return { kind: "none" };

  const base = {
    serverUuid: row.serverUuid,
    projectUuid: row.projectUuid,
    environmentName: row.environmentName,
    domain: row.domain ?? null,
  };
  if (!row.applicationUuid) return { kind: "configured", ...base };

  const provisioned = { ...base, applicationUuid: row.applicationUuid };
  // A deploy time is what makes an address meaningful; without one there is
  // nothing to say the URL was ever reached.
  if (!row.lastDeployedAt) return { kind: "provisioned", ...provisioned };
  return {
    kind: "deployed",
    ...provisioned,
    appUrl: row.appUrl ?? null,
    lastDeployedAt: row.lastDeployedAt,
  };
}

/**
 * The row a state implies, or null when there should be no row at all.
 *
 * Every field is present in the result, so a write can never set some and
 * leave others describing something that no longer exists.
 */
export function coolifyConnectionRow(
  state: CoolifyConnectionState,
): CoolifyConnectionRow | null {
  switch (state.kind) {
    case "none":
      return null;
    case "configured":
      return {
        serverUuid: state.serverUuid,
        projectUuid: state.projectUuid,
        environmentName: state.environmentName,
        applicationUuid: null,
        domain: state.domain,
        appUrl: null,
        lastDeployedAt: null,
      };
    case "provisioned":
      return {
        serverUuid: state.serverUuid,
        projectUuid: state.projectUuid,
        environmentName: state.environmentName,
        applicationUuid: state.applicationUuid,
        domain: state.domain,
        appUrl: null,
        lastDeployedAt: null,
      };
    case "deployed":
      return {
        serverUuid: state.serverUuid,
        projectUuid: state.projectUuid,
        environmentName: state.environmentName,
        applicationUuid: state.applicationUuid,
        domain: state.domain,
        appUrl: state.appUrl,
        lastDeployedAt: state.lastDeployedAt,
      };
    default: {
      const exhaustive: never = state;
      throw new Error(
        `Unhandled connection state: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * The next state, given a change. Total over state x change.
 *
 * Coolify cannot move an application between servers or projects, so choosing
 * a different one releases it: the deploy that follows creates one where the
 * user asked rather than rebuilding where it used to be.
 */
export function applyCoolifyConnectionChange(
  state: CoolifyConnectionState,
  change: CoolifyConnectionChange,
): CoolifyConnectionState {
  switch (change.type) {
    case "DETACHED":
      return { kind: "none" };

    case "CONFIGURED": {
      const chosen = {
        serverUuid: change.serverUuid,
        projectUuid: change.projectUuid,
        environmentName: change.environmentName,
        domain: change.domain,
      };
      if (state.kind === "none") return { kind: "configured", ...chosen };
      // Environment counts with server and project: Coolify cannot move an
      // application between any of the three, so a change to one releases it.
      // Only ever "production" today, which is what makes this latent rather
      // than broken — and what makes it worth fixing before it is not.
      const movedHost =
        state.serverUuid !== change.serverUuid ||
        state.projectUuid !== change.projectUuid ||
        state.environmentName !== change.environmentName;
      if (movedHost) return { kind: "configured", ...chosen };
      // Same host: only the domain changed, so whatever exists in Coolify is
      // still the right application.
      if (state.kind === "configured") return { kind: "configured", ...chosen };
      if (state.kind === "provisioned") {
        return {
          kind: "provisioned",
          ...chosen,
          applicationUuid: state.applicationUuid,
        };
      }
      return {
        kind: "deployed",
        ...chosen,
        applicationUuid: state.applicationUuid,
        appUrl: state.appUrl,
        lastDeployedAt: state.lastDeployedAt,
      };
    }

    case "APPLICATION_GONE": {
      // Back to configured: the address and deploy time described the
      // application Coolify no longer has, and a recreate that then fails
      // would otherwise leave the panel offering a dead link until some
      // later deploy happens to succeed.
      if (state.kind === "none" || state.kind === "configured") return state;
      return {
        kind: "configured",
        serverUuid: state.serverUuid,
        projectUuid: state.projectUuid,
        environmentName: state.environmentName,
        domain: state.domain,
      };
    }

    case "APPLICATION_RESOLVED": {
      // Nothing to attach it to: the pipeline outlived its connection.
      if (state.kind === "none") return state;
      const host = {
        serverUuid: state.serverUuid,
        projectUuid: state.projectUuid,
        environmentName: state.environmentName,
        domain: state.domain,
      };
      // A different application means the old one is gone from Coolify, so
      // the address it answered at is gone with it.
      if (
        state.kind === "deployed" &&
        state.applicationUuid === change.applicationUuid
      ) {
        return state;
      }
      return {
        kind: "provisioned",
        ...host,
        applicationUuid: change.applicationUuid,
      };
    }

    case "DEPLOY_SUCCEEDED": {
      // A result for a connection that no longer exists, or one that never
      // got as far as having an application, describes nothing here.
      if (state.kind === "none" || state.kind === "configured") return state;
      return {
        kind: "deployed",
        serverUuid: state.serverUuid,
        projectUuid: state.projectUuid,
        environmentName: state.environmentName,
        domain: state.domain,
        applicationUuid: state.applicationUuid,
        appUrl: change.appUrl,
        lastDeployedAt: change.at,
      };
    }

    default: {
      const exhaustive: never = change;
      throw new Error(
        `Unhandled connection change: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
