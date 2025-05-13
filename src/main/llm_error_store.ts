class LlmErrorStore {
  private modelErrorToTimestamp: Record<string, number> = {};

  constructor() {}

  recordModelError({ model, provider }: { model: string; provider: string }) {
    this.modelErrorToTimestamp[this.getKey({ model, provider })] = Date.now();
  }

  clearModelError({ model, provider }: { model: string; provider: string }) {
    delete this.modelErrorToTimestamp[this.getKey({ model, provider })];
  }

  modelHasNoRecentError({
    model,
    provider,
  }: {
    model: string;
    provider: string;
  }): boolean {
    const key = this.getKey({ model, provider });
    const timestamp = this.modelErrorToTimestamp[key];
    if (!timestamp) {
      return true;
    }
    const oneHourAgo = Date.now() - 1000 * 60 * 60;
    return timestamp < oneHourAgo;
  }

  private getKey({ model, provider }: { model: string; provider: string }) {
    return `${provider}::${model}`;
  }
}

export const llmErrorStore = new LlmErrorStore();
