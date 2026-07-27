interface ReadinessQueue {
  markReady(): void;
  markNotReady(): void;
}

export class DeepLinkWindowReadiness<TWindow extends object> {
  private readonly readyWindows = new WeakSet<TWindow>();
  private target: TWindow | null = null;

  constructor(private readonly queue: ReadinessQueue) {}

  setTarget(target: TWindow | null): void {
    this.target = target;
    this.syncQueueReadiness();
  }

  markReady(window: TWindow): void {
    this.readyWindows.add(window);
    if (window === this.target) this.queue.markReady();
  }

  private syncQueueReadiness(): void {
    if (this.target && this.readyWindows.has(this.target)) {
      this.queue.markReady();
    } else {
      this.queue.markNotReady();
    }
  }
}
