/**
 * Agent Provenance & Reputation IPC Handlers — Tier 4
 *
 * Channels (12):
 *   Events:     provenance:event:emit, provenance:event:pin,
 *               provenance:event:list, provenance:event:get
 *   Reputation: provenance:score:recompute, provenance:score:get,
 *               provenance:score:list
 *   Slashing:   provenance:slash:propose, provenance:slash:activate,
 *               provenance:slash:reverse, provenance:slash:list
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";

import {
  activateSlash,
  emitEvent,
  getEvent,
  getScore,
  listEvents,
  listScores,
  listSlashes,
  pinEvent,
  proposeSlash,
  recomputeScore,
  reverseSlash,
  type EmitEventInput,
  type EventFilters,
  type ProposeSlashInput,
  type ScoreFilters,
  type SlashFilters,
} from "@/lib/agent_provenance";

const logger = log.scope("agent_provenance_handlers");
const handle = createLoggedHandler(logger);

export function registerAgentProvenanceHandlers(): void {
  handle("provenance:event:emit", async (_e, input: EmitEventInput) => {
    if (!input?.kind) throw new Error("provenance:event:emit: kind required");
    if (!input?.principalDid)
      throw new Error("provenance:event:emit: principalDid required");
    return await emitEvent(input);
  });

  handle("provenance:event:pin", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("provenance:event:pin: id required");
    return await pinEvent(params.id);
  });

  handle("provenance:event:list", async (_e, filters?: EventFilters) => {
    return await listEvents(filters ?? {});
  });

  handle("provenance:event:get", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("provenance:event:get: id required");
    return await getEvent(params.id);
  });

  handle(
    "provenance:score:recompute",
    async (_e, params: { principalDid: string }) => {
      if (!params?.principalDid)
        throw new Error("provenance:score:recompute: principalDid required");
      return await recomputeScore(params.principalDid);
    },
  );

  handle(
    "provenance:score:get",
    async (_e, params: { principalDid: string }) => {
      if (!params?.principalDid)
        throw new Error("provenance:score:get: principalDid required");
      return await getScore(params.principalDid);
    },
  );

  handle("provenance:score:list", async (_e, filters?: ScoreFilters) => {
    return await listScores(filters ?? {});
  });

  handle("provenance:slash:propose", async (_e, input: ProposeSlashInput) => {
    if (!input?.principalDid || !input?.reason)
      throw new Error(
        "provenance:slash:propose: principalDid and reason required",
      );
    return await proposeSlash(input);
  });

  handle(
    "provenance:slash:activate",
    async (_e, params: { id: string }) => {
      if (!params?.id) throw new Error("provenance:slash:activate: id required");
      return await activateSlash(params.id);
    },
  );

  handle(
    "provenance:slash:reverse",
    async (_e, params: { id: string; reason: string }) => {
      if (!params?.id || !params?.reason)
        throw new Error(
          "provenance:slash:reverse: id and reason required",
        );
      return await reverseSlash(params.id, params.reason);
    },
  );

  handle("provenance:slash:list", async (_e, filters?: SlashFilters) => {
    return await listSlashes(filters ?? {});
  });
}
