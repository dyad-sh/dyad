import { ActorHost } from "@/distributed_machines/actor_host";
import { systemClock, uuidIdSource } from "@/state_machines/clock";

export const remoteMachineHost = new ActorHost({
  placement: "main",
  clock: systemClock,
  ids: uuidIdSource,
});
