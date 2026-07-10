export class ChatStreamRuntimeState {
  private readonly activeStreams = new Map<number, AbortController>();
  private readonly partialResponses = new Map<number, string>();

  start(chatId: number, controller: AbortController): void {
    this.activeStreams.set(chatId, controller);
  }

  getController(chatId: number): AbortController | undefined {
    return this.activeStreams.get(chatId);
  }

  deleteController(chatId: number): void {
    this.activeStreams.delete(chatId);
  }

  setPartialResponse(chatId: number, response: string): void {
    this.partialResponses.set(chatId, response);
  }

  getPartialResponse(chatId: number): string {
    return this.partialResponses.get(chatId) ?? "";
  }

  deletePartialResponse(chatId: number): void {
    this.partialResponses.delete(chatId);
  }

  /** Release every main-process reference owned by a terminal stream. */
  finish(chatId: number): void {
    this.activeStreams.delete(chatId);
    this.partialResponses.delete(chatId);
  }

  abortAll(): void {
    for (const controller of this.activeStreams.values()) {
      controller.abort();
    }
    this.activeStreams.clear();
    this.partialResponses.clear();
  }

  hasController(chatId: number): boolean {
    return this.activeStreams.has(chatId);
  }

  hasPartialResponse(chatId: number): boolean {
    return this.partialResponses.has(chatId);
  }
}
