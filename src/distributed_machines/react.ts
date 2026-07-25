import { useMachineSelector } from "@/state_machines/react";
import type { LocalActorRef } from "./definition";

/** Selector-aware React binding shared by local and future remote actor refs. */
export function useActorSelector<State, Event, Selection>(
  actor: LocalActorRef<State, Event>,
  selector: (state: State) => Selection,
  isEqual?: (previous: Selection, next: Selection) => boolean,
): Selection {
  return useMachineSelector(actor, selector, isEqual);
}
