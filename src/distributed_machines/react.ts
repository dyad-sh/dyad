import { createElement, useMemo, type PropsWithChildren } from "react";
import {
  createMachineProvider,
  useMachineSelector,
} from "@/state_machines/react";
import type { IdSource } from "@/state_machines/clock";
import type { IgnoreReason } from "@/state_machines/types";
import type { LocalActorRef } from "./definition";
import {
  RemoteMachineClient,
  type RemoteConnectionStatus,
  type RemoteClientDefinition,
  type RemoteDispatchOptions,
  type RemoteMachineClientConnection,
  type ObservedRevisionToken,
  type RemoteActorView,
} from "./remote_client";
import type { MachineDispatchReceipt } from "./remote_protocol";

/** Selector-aware React binding shared by local and future remote actor refs. */
export function useActorSelector<State, Event, Selection>(
  actor: LocalActorRef<State, Event>,
  selector: (state: State) => Selection,
  isEqual?: (previous: Selection, next: Selection) => boolean,
): Selection {
  return useMachineSelector(actor, selector, isEqual);
}

interface OwnedRemoteMachineClientProps {
  readonly connection: RemoteMachineClientConnection;
  readonly ids: IdSource;
}

const remoteMachineBinding = createMachineProvider<
  RemoteMachineClient,
  OwnedRemoteMachineClientProps
>({
  name: "RemoteMachine",
  useOwnedManager: ({ connection, ids }) => {
    return useMemo(
      () => new RemoteMachineClient(connection, ids),
      [connection, ids],
    );
  },
});

export type RemoteMachineProviderProps = PropsWithChildren<
  { readonly client: RemoteMachineClient } | OwnedRemoteMachineClientProps
>;

/** Owns exactly one remote client for the current renderer window. */
export function RemoteMachineProvider(props: RemoteMachineProviderProps) {
  if ("client" in props) {
    return createElement(
      remoteMachineBinding.Provider,
      { manager: props.client },
      props.children,
    );
  }
  return createElement(
    remoteMachineBinding.Provider,
    { connection: props.connection, ids: props.ids },
    props.children,
  );
}

export const useRemoteMachineClient = remoteMachineBinding.useManager;

const identity = <Value>(value: Value): Value => value;

export function useDistributedMachine<
  Key,
  State,
  Event,
  Reason extends IgnoreReason,
  Projection = State,
>(
  definition: RemoteClientDefinition<Key, State, Event, Reason>,
  key: Key,
  selectProjection?: (state: State) => Projection,
  isEqual?: (previous: Projection, next: Projection) => boolean,
): {
  readonly state: State;
  readonly projection: Projection;
  readonly connection: RemoteConnectionStatus;
  readonly snapshot: RemoteActorView<State>["snapshot"];
  readonly observedRevision?: ObservedRevisionToken;
  readonly dispatch: (
    event: Event,
    options?: RemoteDispatchOptions,
  ) => Promise<MachineDispatchReceipt<Reason>>;
} {
  const client = useRemoteMachineClient();
  const actor = client.actor(definition, key);
  const projector =
    selectProjection ?? (identity as (state: State) => Projection);
  const source = useMemo(
    () => ({
      subscribe: actor.subscribe,
      getSnapshot: actor.getView,
    }),
    [actor],
  );
  const selected = useMachineSelector(
    source,
    (view) => ({
      view,
      projection: projector(view.state),
    }),
    (previous, next) =>
      previous.view === next.view &&
      (isEqual
        ? isEqual(previous.projection, next.projection)
        : Object.is(previous.projection, next.projection)),
  );
  return {
    state: selected.view.state,
    projection: selected.projection,
    connection: selected.view.connection,
    snapshot: selected.view.snapshot,
    observedRevision:
      selected.view.snapshot.kind === "available"
        ? selected.view.snapshot.observedRevision
        : undefined,
    dispatch: actor.dispatch,
  };
}
