import type { ActorEventSink } from "./definition";

export interface CorrelatedEffectContext<Event> {
  readonly sink: ActorEventSink<Event>;
  readonly signal: AbortSignal;
}

export interface CorrelatedEffectHandler<Command, Result, Failure, Event> {
  readonly correlation: (command: Command) => string;
  readonly disposal: "abort-and-settle";
  readonly run: (
    command: Command,
    context: CorrelatedEffectContext<Event>,
  ) => Promise<Result>;
  readonly succeeded: (command: Command, result: Result) => Event;
  readonly failed: (command: Command, failure: Failure) => Event;
  readonly cancelled: (command: Command) => Event;
  readonly classifyFailure: (
    error: unknown,
  ) =>
    | { readonly kind: "expected"; readonly failure: Failure }
    | { readonly kind: "cancelled" }
    | { readonly kind: "unexpected"; readonly failure: Failure };
}

type CorrelatedEffectHandlerMap<
  Command extends { readonly type: string },
  Event,
> = {
  readonly [Type in Command["type"]]: CorrelatedEffectHandler<
    Extract<Command, { readonly type: Type }>,
    unknown,
    unknown,
    Event
  >;
};

/**
 * The deliberately small one-shot effect vocabulary used by the production
 * pilots. The mapped type makes every declared command kind explicit.
 */
export function defineCorrelatedEffectHandlers<
  Command extends { readonly type: string },
  Event,
>() {
  return <Handlers extends CorrelatedEffectHandlerMap<Command, Event>>(
    handlers: Handlers,
  ): Handlers => handlers;
}

export interface RunCorrelatedEffectOptions<
  Command extends { readonly type: string },
  Event,
> {
  readonly command: Command;
  readonly handlers: CorrelatedEffectHandlerMap<Command, Event>;
  readonly sink: ActorEventSink<Event>;
  readonly signal?: AbortSignal;
  readonly reportUnexpected?: (error: unknown) => void;
}

/**
 * Runs one accepted effect to exactly one correlated terminal event. Unexpected
 * dependency/programming failures remain visible through reportUnexpected while
 * still settling the owning operation with the handler's declared fallback.
 */
export async function runCorrelatedEffect<
  Command extends { readonly type: string },
  Event,
>(options: RunCorrelatedEffectOptions<Command, Event>): Promise<void> {
  const handler = options.handlers[options.command.type as Command["type"]] as
    | CorrelatedEffectHandler<Command, unknown, unknown, Event>
    | undefined;
  if (!handler) {
    throw new Error(
      `Missing correlated effect handler: ${options.command.type}`,
    );
  }
  const signal = options.signal ?? new AbortController().signal;
  let terminal: Event;
  if (signal.aborted) {
    terminal = handler.cancelled(options.command);
  } else {
    try {
      const result = await handler.run(options.command, {
        sink: options.sink,
        signal,
      });
      terminal = signal.aborted
        ? handler.cancelled(options.command)
        : handler.succeeded(options.command, result);
    } catch (error) {
      const classified = handler.classifyFailure(error);
      if (classified.kind === "cancelled") {
        terminal = handler.cancelled(options.command);
      } else {
        if (classified.kind === "unexpected") {
          try {
            options.reportUnexpected?.(error);
          } catch {
            // Reporting cannot replace correlated settlement.
          }
        }
        terminal = handler.failed(options.command, classified.failure);
      }
    }
  }
  options.sink.send(terminal);
}
