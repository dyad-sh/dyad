export type EntityDisposer = (entityId: number) => void;

/** Provider-owned registry for cleanup tied to deleted persistent entities. */
export class EntityDisposalRegistry {
  private readonly appDisposers = new Set<EntityDisposer>();
  private readonly chatDisposers = new Set<EntityDisposer>();

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
    disposers: Set<EntityDisposer>,
    dispose: EntityDisposer,
  ): () => void {
    disposers.add(dispose);
    return () => disposers.delete(dispose);
  }

  private disposeEntity(disposers: Set<EntityDisposer>, entityId: number) {
    const errors: unknown[] = [];
    for (const dispose of Array.from(disposers)) {
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
