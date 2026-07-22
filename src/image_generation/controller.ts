import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import type {
  ImageGenerationCommand,
  ImageGenerationEvent,
  ImageGenerationJobDetails,
  ImageGenerationState,
} from "./state";
import { transition } from "./transition";

export interface ImageGenerationCommandRunner {
  run(
    command: ImageGenerationCommand,
    emit: (event: ImageGenerationEvent) => void,
  ): void;
}

export class ImageGenerationController {
  private readonly store: SnapshotStore<ImageGenerationState>;
  private readonly pendingEvents: ImageGenerationEvent[] = [];
  private processing = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly runner: ImageGenerationCommandRunner,
    job: ImageGenerationJobDetails,
    private readonly observer?: TransitionObserver<
      ImageGenerationState,
      ImageGenerationEvent,
      ImageGenerationCommand
    >,
  ) {
    this.store = new SnapshotStore({ type: "pending", job });
  }

  getSnapshot = (): ImageGenerationState => this.store.getSnapshot();

  subscribe = (listener: () => void): (() => void) =>
    this.store.subscribe(listener);

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const { job } = this.store.getSnapshot();
    this.run({
      type: "GenerateImage",
      jobId: job.id,
      params: {
        prompt: job.prompt,
        themeMode: job.themeMode,
        targetAppId: job.targetAppId,
        targetAppName: job.targetAppName,
        source: job.source,
      },
    });
  }

  send = (event: ImageGenerationEvent): void => {
    if (this.disposed) return;
    this.pendingEvents.push(event);
    if (this.processing) return;
    this.processing = true;
    try {
      for (
        let next = this.pendingEvents.shift();
        next !== undefined;
        next = this.pendingEvents.shift()
      ) {
        const previous = this.store.getSnapshot();
        const result = transition(previous, next);
        observeTransition(this.observer, previous, next, result);
        if (result.state !== previous) this.store.setState(result.state);
        for (const command of result.commands) this.run(command);
      }
    } finally {
      this.processing = false;
    }
  };

  private run(command: ImageGenerationCommand): void {
    try {
      this.runner.run(command, this.send);
    } catch (error) {
      console.error("Image-generation command execution failed:", error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    const state = this.store.getSnapshot();
    if (state.type === "pending") {
      try {
        this.runner.run(
          { type: "RequestCancel", jobId: state.job.id },
          () => undefined,
        );
      } catch (error) {
        console.error("Image-generation disposal command failed:", error);
      }
    }
    this.disposed = true;
    this.pendingEvents.length = 0;
    this.store.dispose();
  }
}
