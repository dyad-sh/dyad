import { describe, expect, it } from "vitest";
import {
  applyCoolifyConnectionChange,
  coolifyConnectionColumns,
  coolifyConnectionFromColumns,
  type CoolifyConnectionChange,
  type CoolifyConnectionState,
} from "./connection";

const AT = new Date(1_700_000_000_000);

const HOST = {
  serverUuid: "srv-1",
  projectUuid: "prj-1",
  environmentName: "production",
  domain: "https://demo.example.com",
} as const;

const STATES: CoolifyConnectionState[] = [
  { kind: "none" },
  { kind: "configured", ...HOST },
  { kind: "provisioned", ...HOST, applicationUuid: "app-1" },
  {
    kind: "deployed",
    ...HOST,
    applicationUuid: "app-1",
    appUrl: "https://demo.example.com",
    lastDeployedAt: AT,
  },
];

const CHANGES: CoolifyConnectionChange[] = [
  { type: "CONFIGURED", ...HOST },
  { type: "CONFIGURED", ...HOST, serverUuid: "srv-2" },
  { type: "CONFIGURED", ...HOST, projectUuid: "prj-2" },
  { type: "CONFIGURED", ...HOST, domain: null },
  { type: "DETACHED" },
  { type: "APPLICATION_RESOLVED", applicationUuid: "app-1" },
  { type: "APPLICATION_RESOLVED", applicationUuid: "app-2" },
  { type: "DEPLOY_SUCCEEDED", appUrl: "https://demo.example.com", at: AT },
  { type: "DEPLOY_SUCCEEDED", appUrl: null, at: AT },
];

describe("the connection is total over state x change", () => {
  it("answers every pair with a state that round-trips through its columns", () => {
    for (const state of STATES) {
      for (const change of CHANGES) {
        const next = applyCoolifyConnectionChange(state, change);
        // The columns are the only thing persisted, so a state that does not
        // survive them is a state the database cannot actually hold.
        expect(
          coolifyConnectionFromColumns(coolifyConnectionColumns(next)),
        ).toEqual(next);
      }
    }
  });

  it("never writes a partial record", () => {
    // Every bug this replaces was a write that set some columns and left
    // others describing something that no longer existed.
    for (const state of STATES) {
      for (const change of CHANGES) {
        const columns = coolifyConnectionColumns(
          applyCoolifyConnectionChange(state, change),
        );
        expect(Object.keys(columns).sort()).toEqual([
          "coolifyAppUrl",
          "coolifyApplicationUuid",
          "coolifyDomain",
          "coolifyEnvironmentName",
          "coolifyLastDeployedAt",
          "coolifyProjectUuid",
          "coolifyServerUuid",
        ]);
        // An address or a deploy time without an application, or an
        // application without a server, is exactly what could be written
        // before and cannot be expressed now.
        if (!columns.coolifyServerUuid) {
          expect(columns.coolifyApplicationUuid).toBeNull();
          expect(columns.coolifyAppUrl).toBeNull();
          expect(columns.coolifyLastDeployedAt).toBeNull();
        }
        if (!columns.coolifyApplicationUuid) {
          expect(columns.coolifyAppUrl).toBeNull();
          expect(columns.coolifyLastDeployedAt).toBeNull();
        }
      }
    }
  });
});

describe("moving between hosts", () => {
  it("releases an application when the server changes", () => {
    const deployed = STATES[3];
    const next = applyCoolifyConnectionChange(deployed, {
      type: "CONFIGURED",
      ...HOST,
      serverUuid: "srv-2",
    });
    expect(next).toEqual({ kind: "configured", ...HOST, serverUuid: "srv-2" });
  });

  it("releases an application when the project changes", () => {
    const next = applyCoolifyConnectionChange(STATES[3], {
      type: "CONFIGURED",
      ...HOST,
      projectUuid: "prj-2",
    });
    expect(next.kind).toBe("configured");
  });

  it("keeps the application and its address when only the domain changes", () => {
    const next = applyCoolifyConnectionChange(STATES[3], {
      type: "CONFIGURED",
      ...HOST,
      domain: "https://other.example.com",
    });
    expect(next).toMatchObject({
      kind: "deployed",
      applicationUuid: "app-1",
      appUrl: "https://demo.example.com",
      domain: "https://other.example.com",
    });
  });
});

describe("what the pipeline reports", () => {
  it("drops a stale address when the application is replaced", () => {
    const next = applyCoolifyConnectionChange(STATES[3], {
      type: "APPLICATION_RESOLVED",
      applicationUuid: "app-2",
    });
    expect(next).toEqual({
      kind: "provisioned",
      ...HOST,
      applicationUuid: "app-2",
    });
  });

  it("leaves a deployed record alone when the same application is adopted", () => {
    expect(
      applyCoolifyConnectionChange(STATES[3], {
        type: "APPLICATION_RESOLVED",
        applicationUuid: "app-1",
      }),
    ).toEqual(STATES[3]);
  });

  it("ignores a result that arrives after the connection is gone", () => {
    expect(
      applyCoolifyConnectionChange(
        { kind: "none" },
        { type: "DEPLOY_SUCCEEDED", appUrl: "https://x.example.com", at: AT },
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("reading rows the union did not write", () => {
  it("treats an application without a server as no connection", () => {
    expect(
      coolifyConnectionFromColumns({
        coolifyServerUuid: null,
        coolifyProjectUuid: null,
        coolifyApplicationUuid: "app-1",
        coolifyAppUrl: "https://stale.example.com",
      }),
    ).toEqual({ kind: "none" });
  });

  it("treats an address without a deploy time as not yet deployed", () => {
    expect(
      coolifyConnectionFromColumns({
        coolifyServerUuid: "srv-1",
        coolifyProjectUuid: "prj-1",
        coolifyApplicationUuid: "app-1",
        coolifyAppUrl: "https://stale.example.com",
        coolifyLastDeployedAt: null,
      }),
    ).toMatchObject({ kind: "provisioned" });
  });

  it("defaults a missing environment to the one Coolify creates", () => {
    expect(
      coolifyConnectionFromColumns({
        coolifyServerUuid: "srv-1",
        coolifyProjectUuid: "prj-1",
      }),
    ).toMatchObject({ environmentName: "production" });
  });
});
