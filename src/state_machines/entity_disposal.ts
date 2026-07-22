export type EntityDisposer = (entityId: number) => void;

/** Provider-owned registry for cleanup tied to deleted persistent entities. */
export class EntityDisposalRegistry {
  private readonly appDisposers = new Map<EntityDisposer, number>();
  private readonly chatDisposers = new Map<EntityDisposer, number>();

  onAppDeleted(dispose: EntityDisposer): () => void {
    return this.register(this.appDisposers, dispose);
  }

  onChatDeleted(dispose: EntityDisposer): () => void {
    return this.register(this.chatDisposers, dispose);
  }

  disposeForApp(appId: number): void {
    this.disposeEntity(this.appDisposers, appId);
  }

  disposeForChat(chatId: number): void {
    this.disposeEntity(this.chatDisposers, chatId);
  }

  private register(
    disposers: Map<EntityDisposer, number>,
    dispose: EntityDisposer,
  ): () => void {
    disposers.set(dispose, (disposers.get(dispose) ?? 0) + 1);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const registrations = disposers.get(dispose);
      if (registrations === undefined) return;
      if (registrations === 1) disposers.delete(dispose);
      else disposers.set(dispose, registrations - 1);
    };
  }

  private disposeEntity(
    disposers: Map<EntityDisposer, number>,
    entityId: number,
  ) {
    const errors: unknown[] = [];
    for (const dispose of Array.from(disposers.keys())) {
      try {
        dispose(entityId);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to dispose entity ${entityId}`);
    }
  }
}
