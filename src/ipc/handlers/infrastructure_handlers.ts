import { createTypedHandler } from "./base";
import { infrastructureContracts } from "../types/infrastructure";
import { scan, snapshot } from "../utils/infrastructure/engine";

/**
 * Infrastructure monitor IPC.
 *
 * Thin on purpose: discovery belongs to the engine, and this only decides
 * whether the caller wants what is already known or a fresh pass.
 */
export function registerInfrastructureHandlers() {
  createTypedHandler(infrastructureContracts.snapshot, async () => snapshot());

  createTypedHandler(infrastructureContracts.scan, async () => {
    await scan();
    return snapshot();
  });
}
