/**
 * Image-generation jobs share one global collection actor, so destructive app
 * admission must be serialized even when the apps themselves are unrelated.
 */
export class AppDeletionQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<Result>(deletion: () => Promise<Result>): Promise<Result> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await deletion();
    } finally {
      release();
    }
  }
}

export const appDeletionQueue = new AppDeletionQueue();
