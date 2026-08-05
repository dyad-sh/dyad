/**
 * An app's Coolify record, as a shape that cannot hold a contradiction.
 *
 * These seven columns were written from twenty-eight places, each deciding for
 * itself which subset to clear. Seven nullable columns admit a hundred and
 * twenty-eight combinations and about four of them mean anything, so nearly
 * every bug here has been the same one: cleared the application id but not the
 * URL, cleared the URL but not the deploy time, kept an application that
 * belonged to a server the app had already left.
 *
 * A change is applied by `applyCoolifyConnectionChange` and written by
 * `coolifyConnectionColumns`, which always writes all seven. There is no way
 * to update a subset, so there is no way to update an inconsistent subset.
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
  /** The pipeline finished and the app is reachable. */
  | { type: "DEPLOY_SUCCEEDED"; appUrl: string | null; at: Date };

/** The seven columns, always written together. */
export interface CoolifyConnectionColumns {
  coolifyServerUuid: string | null;
  coolifyProjectUuid: string | null;
  coolifyEnvironmentName: string | null;
  coolifyApplicationUuid: string | null;
  coolifyDomain: string | null;
  coolifyAppUrl: string | null;
  coolifyLastDeployedAt: Date | null;
}

/**
 * Reads a stored row back into a state.
 *
 * Rows written before this existed, or by hand, can still hold a combination
 * the union does not describe. Those degrade to the strongest state their
 * fields actually support rather than being trusted.
 */
export function coolifyConnectionFromColumns(
  row: Partial<CoolifyConnectionColumns>,
): CoolifyConnectionState {
  const { coolifyServerUuid, coolifyProjectUuid } = row;
  if (!coolifyServerUuid || !coolifyProjectUuid) return { kind: "none" };

  const base = {
    serverUuid: coolifyServerUuid,
    projectUuid: coolifyProjectUuid,
    environmentName: row.coolifyEnvironmentName ?? "production",
    domain: row.coolifyDomain ?? null,
  };
  if (!row.coolifyApplicationUuid) return { kind: "configured", ...base };

  const provisioned = {
    ...base,
    applicationUuid: row.coolifyApplicationUuid,
  };
  // A deploy time is what makes an address meaningful; without one there is
  // nothing to say the URL was ever reached.
  if (!row.coolifyLastDeployedAt)
    return { kind: "provisioned", ...provisioned };
  return {
    kind: "deployed",
    ...provisioned,
    appUrl: row.coolifyAppUrl ?? null,
    lastDeployedAt: row.coolifyLastDeployedAt,
  };
}

/** Every column the state implies, so a write can never be partial. */
export function coolifyConnectionColumns(
  state: CoolifyConnectionState,
): CoolifyConnectionColumns {
  const empty: CoolifyConnectionColumns = {
    coolifyServerUuid: null,
    coolifyProjectUuid: null,
    coolifyEnvironmentName: null,
    coolifyApplicationUuid: null,
    coolifyDomain: null,
    coolifyAppUrl: null,
    coolifyLastDeployedAt: null,
  };
  switch (state.kind) {
    case "none":
      return empty;
    case "configured":
      return {
        ...empty,
        coolifyServerUuid: state.serverUuid,
        coolifyProjectUuid: state.projectUuid,
        coolifyEnvironmentName: state.environmentName,
        coolifyDomain: state.domain,
      };
    case "provisioned":
      return {
        ...empty,
        coolifyServerUuid: state.serverUuid,
        coolifyProjectUuid: state.projectUuid,
        coolifyEnvironmentName: state.environmentName,
        coolifyDomain: state.domain,
        coolifyApplicationUuid: state.applicationUuid,
      };
    case "deployed":
      return {
        coolifyServerUuid: state.serverUuid,
        coolifyProjectUuid: state.projectUuid,
        coolifyEnvironmentName: state.environmentName,
        coolifyDomain: state.domain,
        coolifyApplicationUuid: state.applicationUuid,
        coolifyAppUrl: state.appUrl,
        coolifyLastDeployedAt: state.lastDeployedAt,
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
      const movedHost =
        state.serverUuid !== change.serverUuid ||
        state.projectUuid !== change.projectUuid;
      if (movedHost) return { kind: "configured", ...chosen };
      // Same host: only the domain or environment changed, so whatever exists
      // in Coolify is still the right application.
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
