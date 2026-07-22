import type { TransitionResult } from "./types";

/**
 * Domain-free interleaving co-simulation for finite state-machine models.
 *
 * Concurrency policy: channel messages and each participant's commands are
 * FIFO, while the driver explores every ordering between channel delivery,
 * enabled external actions, and the head command of each participant. A
 * command route is one atomic scheduler action; all events and enqueues it
 * returns are applied in array order. Staleness remains domain behavior: the
 * driver only reports a structurally ignored transition when it retains the
 * state reference and emits no commands.
 *
 * API clarification from plans/even-more-machines.md Phase 4 item 3:
 * `maxSchedules` bounds unique global configurations (schedule prefixes), not
 * only quiescent leaves. This makes the bound useful for non-quiescent or
 * accidentally unbounded models. `schedulesExplored` reports that same count.
 * Keys and descriptions are caller projections, so the kernel neither
 * serializes domain objects nor introduces clocks, randomness, or mutable
 * module-level state. An exhaustive run reports the shortest failing trace;
 * a bounded run reports the shortest failure observed before the bound.
 */

export type CosimTransitionResult<State, Command> = Pick<
  TransitionResult<State, Command>,
  "state" | "commands"
>;

export interface CosimParticipant<State, Event, Command> {
  initialState: State;
  transition(state: State, event: Event): CosimTransitionResult<State, Command>;
  stateKey(state: State): string;
  commandKey(command: Command): string;
  describeEvent?(event: Event): string;
  describeCommand?(command: Command): string;
}

export interface CosimChannel<ParticipantName extends string, Event> {
  recipient: ParticipantName;
  initial?: readonly Event[];
  eventKey(event: Event): string;
  describeEvent?(event: Event): string;
}

export type CosimEffect<
  ParticipantName extends string,
  ChannelName extends string,
  Event,
> =
  | {
      target: "participant";
      participant: ParticipantName;
      event: Event;
    }
  | {
      target: "channel";
      channel: ChannelName;
      event: Event;
    };

export type CosimSnapshot<
  ParticipantName extends string,
  ChannelName extends string,
  State,
  Event,
  Command,
> = {
  participants: Readonly<Record<ParticipantName, State>>;
  channels: Readonly<Record<ChannelName, readonly Event[]>>;
  pendingCommands: Readonly<Record<ParticipantName, readonly Command[]>>;
  remainingActionIds: readonly string[];
};

export type CosimScenarioAction<
  ParticipantName extends string,
  ChannelName extends string,
  State,
  Event,
  Command,
> = CosimEffect<ParticipantName, ChannelName, Event> & {
  id: string;
  label?: string;
  enabled?(
    snapshot: CosimSnapshot<
      ParticipantName,
      ChannelName,
      State,
      Event,
      Command
    >,
  ): boolean;
};

export interface CosimTransitionStep<
  ParticipantName extends string,
  State,
  Event,
  Command,
> {
  participant: ParticipantName;
  previousState: State;
  event: Event;
  result: CosimTransitionResult<State, Command>;
  ignored: boolean;
}

export interface CosimStep<
  ParticipantName extends string,
  ChannelName extends string,
  State,
  Event,
  Command,
> {
  kind: "deliver" | "inject" | "command";
  description: string;
  transitions: readonly CosimTransitionStep<
    ParticipantName,
    State,
    Event,
    Command
  >[];
  snapshot: CosimSnapshot<ParticipantName, ChannelName, State, Event, Command>;
}

export interface CosimFailure {
  phase: "step" | "quiescence" | "driver";
  message: string;
  trace: readonly string[];
  formattedTrace: string;
}

export interface CosimResult {
  schedulesExplored: number;
  quiescentSchedules: number;
  exhaustive: boolean;
  boundReached: boolean;
  failure?: CosimFailure;
}

type Assertion<Value> =
  | ((value: Value) => void)
  | readonly ((value: Value) => void)[];

interface Configuration<
  ParticipantName extends string,
  ChannelName extends string,
  State,
  Event,
  Command,
> {
  states: Record<ParticipantName, State>;
  channels: Record<ChannelName, readonly Event[]>;
  commands: Record<ParticipantName, readonly Command[]>;
  remainingActions: readonly number[];
}

interface PendingAction<ConfigurationValue, StepValue> {
  apply(): { configuration: ConfigurationValue; step: StepValue };
}

function assertions<Value>(
  value: Assertion<Value> | undefined,
): readonly ((value: Value) => void)[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as (value: Value) => void];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatFailure(
  phase: CosimFailure["phase"],
  message: string,
  trace: readonly string[],
): CosimFailure {
  const heading =
    phase === "quiescence"
      ? "Co-simulation quiescence assertion failed"
      : phase === "step"
        ? "Co-simulation step invariant failed"
        : "Co-simulation driver action failed";
  const actionList =
    trace.length === 0
      ? "  (initial configuration)"
      : trace.map((action, index) => `  ${index + 1}. ${action}`).join("\n");
  return {
    phase,
    message,
    trace,
    formattedTrace: `${heading}: ${message}\nSchedule:\n${actionList}`,
  };
}

function preferFailure(
  current: CosimFailure | undefined,
  candidate: CosimFailure,
): CosimFailure {
  if (current === undefined || candidate.trace.length < current.trace.length) {
    return candidate;
  }
  if (candidate.trace.length > current.trace.length) return current;
  return candidate.formattedTrace < current.formattedTrace
    ? candidate
    : current;
}

export function runCosim<
  ParticipantName extends string,
  ChannelName extends string,
  State,
  Event,
  Command,
>(options: {
  participants: Record<
    ParticipantName,
    CosimParticipant<State, Event, Command>
  >;
  channels: Record<ChannelName, CosimChannel<ParticipantName, Event>>;
  scenario: {
    actions: readonly CosimScenarioAction<
      ParticipantName,
      ChannelName,
      State,
      Event,
      Command
    >[];
    routeCommand(
      source: { participant: ParticipantName; command: Command },
      snapshot: CosimSnapshot<
        ParticipantName,
        ChannelName,
        State,
        Event,
        Command
      >,
    ): readonly CosimEffect<ParticipantName, ChannelName, Event>[];
  };
  assertions?: {
    perStep?: Assertion<
      CosimStep<ParticipantName, ChannelName, State, Event, Command>
    >;
    atQuiescence?: Assertion<
      CosimSnapshot<ParticipantName, ChannelName, State, Event, Command>
    >;
  };
  maxSchedules?: number;
}): CosimResult {
  const participantNames = Object.keys(
    options.participants,
  ) as ParticipantName[];
  const channelNames = Object.keys(options.channels) as ChannelName[];
  const maxSchedules = options.maxSchedules ?? 10_000;
  if (!Number.isInteger(maxSchedules) || maxSchedules < 1) {
    throw new Error("maxSchedules must be a positive integer");
  }
  const actionIds = options.scenario.actions.map((action) => action.id);
  if (new Set(actionIds).size !== actionIds.length) {
    throw new Error("Scenario action ids must be unique");
  }

  type Config = Configuration<
    ParticipantName,
    ChannelName,
    State,
    Event,
    Command
  >;
  type Step = CosimStep<ParticipantName, ChannelName, State, Event, Command>;

  const snapshot = (
    configuration: Config,
  ): CosimSnapshot<ParticipantName, ChannelName, State, Event, Command> => ({
    participants: configuration.states,
    channels: configuration.channels,
    pendingCommands: configuration.commands,
    remainingActionIds: configuration.remainingActions.map(
      (index) => options.scenario.actions[index].id,
    ),
  });

  const configurationKey = (configuration: Config): string =>
    JSON.stringify({
      states: participantNames.map((name) => [
        name,
        options.participants[name].stateKey(configuration.states[name]),
      ]),
      channels: channelNames.map((name) => [
        name,
        configuration.channels[name].map((event) =>
          options.channels[name].eventKey(event),
        ),
      ]),
      commands: participantNames.map((name) => [
        name,
        configuration.commands[name].map((command) =>
          options.participants[name].commandKey(command),
        ),
      ]),
      remainingActions: configuration.remainingActions.map(
        (index) => options.scenario.actions[index].id,
      ),
    });

  const transition = (
    configuration: Config,
    participantName: ParticipantName,
    event: Event,
  ): {
    configuration: Config;
    transition: CosimTransitionStep<ParticipantName, State, Event, Command>;
  } => {
    const participant = options.participants[participantName];
    const previousState = configuration.states[participantName];
    const result = participant.transition(previousState, event);
    if (
      result === undefined ||
      result === null ||
      !Array.isArray(result.commands)
    ) {
      throw new Error(
        `Participant "${participantName}" returned an invalid transition result`,
      );
    }
    return {
      configuration: {
        ...configuration,
        states:
          result.state === previousState
            ? configuration.states
            : { ...configuration.states, [participantName]: result.state },
        commands:
          result.commands.length === 0
            ? configuration.commands
            : {
                ...configuration.commands,
                [participantName]: [
                  ...configuration.commands[participantName],
                  ...result.commands,
                ],
              },
      },
      transition: {
        participant: participantName,
        previousState,
        event,
        result,
        ignored: result.state === previousState && result.commands.length === 0,
      },
    };
  };

  const describeEffect = (
    effect: CosimEffect<ParticipantName, ChannelName, Event>,
  ): string => {
    if (effect.target === "channel") {
      const channel = options.channels[effect.channel];
      return `enqueue ${channel.describeEvent?.(effect.event) ?? channel.eventKey(effect.event)} on "${effect.channel}"`;
    }
    const participant = options.participants[effect.participant];
    return `send ${participant.describeEvent?.(effect.event) ?? String(effect.event)} to "${effect.participant}"`;
  };

  const applyEffects = (
    configuration: Config,
    effects: readonly CosimEffect<ParticipantName, ChannelName, Event>[],
  ): {
    configuration: Config;
    transitions: CosimTransitionStep<ParticipantName, State, Event, Command>[];
  } => {
    let next = configuration;
    const transitions = [];
    for (const effect of effects) {
      if (effect.target === "channel") {
        next = {
          ...next,
          channels: {
            ...next.channels,
            [effect.channel]: [...next.channels[effect.channel], effect.event],
          },
        };
      } else {
        const applied = transition(next, effect.participant, effect.event);
        next = applied.configuration;
        transitions.push(applied.transition);
      }
    }
    return { configuration: next, transitions };
  };

  const enabledActions = (
    configuration: Config,
  ): PendingAction<Config, Step>[] => {
    const enabled: PendingAction<Config, Step>[] = [];

    for (const channelName of channelNames) {
      const queue = configuration.channels[channelName];
      if (queue.length === 0) continue;
      enabled.push({
        apply: () => {
          const channel = options.channels[channelName];
          const event = queue[0];
          const withoutHead: Config = {
            ...configuration,
            channels: {
              ...configuration.channels,
              [channelName]: queue.slice(1),
            },
          };
          const applied = transition(withoutHead, channel.recipient, event);
          const description = `deliver "${channelName}" to "${channel.recipient}": ${channel.describeEvent?.(event) ?? channel.eventKey(event)}${applied.transition.ignored ? " (ignored)" : ""}`;
          return {
            configuration: applied.configuration,
            step: {
              kind: "deliver",
              description,
              transitions: [applied.transition],
              snapshot: snapshot(applied.configuration),
            },
          };
        },
      });
    }

    const currentSnapshot = snapshot(configuration);
    for (const actionIndex of configuration.remainingActions) {
      const action = options.scenario.actions[actionIndex];
      if (action.enabled?.(currentSnapshot) === false) continue;
      enabled.push({
        apply: () => {
          const remainingActions = configuration.remainingActions.filter(
            (index) => index !== actionIndex,
          );
          const base = { ...configuration, remainingActions };
          const effect: CosimEffect<ParticipantName, ChannelName, Event> =
            action;
          const applied = applyEffects(base, [effect]);
          const transitionSuffix =
            applied.transitions.length === 1 && applied.transitions[0].ignored
              ? " (ignored)"
              : "";
          const description = `inject "${action.label ?? action.id}": ${describeEffect(effect)}${transitionSuffix}`;
          return {
            configuration: applied.configuration,
            step: {
              kind: "inject",
              description,
              transitions: applied.transitions,
              snapshot: snapshot(applied.configuration),
            },
          };
        },
      });
    }

    for (const participantName of participantNames) {
      const queue = configuration.commands[participantName];
      if (queue.length === 0) continue;
      enabled.push({
        apply: () => {
          const participant = options.participants[participantName];
          const command = queue[0];
          const withoutHead: Config = {
            ...configuration,
            commands: {
              ...configuration.commands,
              [participantName]: queue.slice(1),
            },
          };
          const effects = options.scenario.routeCommand(
            { participant: participantName, command },
            snapshot(withoutHead),
          );
          const applied = applyEffects(withoutHead, effects);
          const routed =
            effects.length === 0
              ? "no follow-up (dropped)"
              : effects.map(describeEffect).join(", then ");
          const description = `execute "${participantName}" command: ${participant.describeCommand?.(command) ?? participant.commandKey(command)} => ${routed}`;
          return {
            configuration: applied.configuration,
            step: {
              kind: "command",
              description,
              transitions: applied.transitions,
              snapshot: snapshot(applied.configuration),
            },
          };
        },
      });
    }

    return enabled;
  };

  const initialStates = {} as Record<ParticipantName, State>;
  const initialCommands = {} as Record<ParticipantName, readonly Command[]>;
  for (const name of participantNames) {
    initialStates[name] = options.participants[name].initialState;
    initialCommands[name] = [];
  }
  const initialChannels = {} as Record<ChannelName, readonly Event[]>;
  for (const name of channelNames) {
    initialChannels[name] = [...(options.channels[name].initial ?? [])];
  }
  const initial: Config = {
    states: initialStates,
    channels: initialChannels,
    commands: initialCommands,
    remainingActions: options.scenario.actions.map((_action, index) => index),
  };

  const stack: { configuration: Config; trace: readonly string[] }[] = [
    { configuration: initial, trace: [] },
  ];
  const bestDepth = new Map<string, number>([[configurationKey(initial), 0]]);
  const quiescentKeys = new Set<string>();
  let boundReached = false;
  let failure: CosimFailure | undefined;

  while (stack.length > 0 && !boundReached) {
    const current = stack.pop();
    if (current === undefined) break;
    const currentKey = configurationKey(current.configuration);
    if (bestDepth.get(currentKey) !== current.trace.length) continue;

    let actions: PendingAction<Config, Step>[];
    try {
      actions = enabledActions(current.configuration);
    } catch (error) {
      failure = preferFailure(
        failure,
        formatFailure("driver", errorMessage(error), current.trace),
      );
      continue;
    }

    if (actions.length === 0) {
      quiescentKeys.add(currentKey);
      for (const assertion of assertions(options.assertions?.atQuiescence)) {
        try {
          assertion(snapshot(current.configuration));
        } catch (error) {
          failure = preferFailure(
            failure,
            formatFailure("quiescence", errorMessage(error), current.trace),
          );
        }
      }
      continue;
    }

    const successors: { configuration: Config; trace: readonly string[] }[] =
      [];
    for (const action of actions) {
      let applied: { configuration: Config; step: Step };
      try {
        applied = action.apply();
      } catch (error) {
        failure = preferFailure(
          failure,
          formatFailure("driver", errorMessage(error), current.trace),
        );
        continue;
      }
      const nextTrace = [...current.trace, applied.step.description];
      let invariantFailed = false;
      for (const assertion of assertions(options.assertions?.perStep)) {
        try {
          assertion(applied.step);
        } catch (error) {
          invariantFailed = true;
          failure = preferFailure(
            failure,
            formatFailure("step", errorMessage(error), nextTrace),
          );
        }
      }
      if (invariantFailed) continue;

      const key = configurationKey(applied.configuration);
      const previousDepth = bestDepth.get(key);
      if (previousDepth !== undefined && previousDepth <= nextTrace.length) {
        continue;
      }
      if (previousDepth === undefined && bestDepth.size >= maxSchedules) {
        boundReached = true;
        break;
      }
      bestDepth.set(key, nextTrace.length);
      successors.push({
        configuration: applied.configuration,
        trace: nextTrace,
      });
    }
    for (let index = successors.length - 1; index >= 0; index -= 1) {
      stack.push(successors[index]);
    }
  }

  return {
    schedulesExplored: bestDepth.size,
    quiescentSchedules: quiescentKeys.size,
    exhaustive: !boundReached,
    boundReached,
    failure,
  };
}
