import { ActorHost } from "@/distributed_machines/actor_host";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { reportActorHostError } from "./distributed_machine_error_reporter";

export const remoteMachineHost = new ActorHost({
  placement: "main",
  clock: systemClock,
  ids: uuidIdSource,
  reportError: reportActorHostError,
});
