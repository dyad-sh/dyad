export const DEFAULT_MODELS_BY_PROVIDER: Record<string, string> = {
  openai: "gpt-5.2",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-flash-latest",
  vertex: "gemini-flash-latest",
  openrouter: "openrouter/free",
  azure: "gpt-5.1",
  xai: "grok-code-fast-1",
  bedrock: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  minimax: "MiniMax-M2.7",
};

export function getDefaultModelForProvider(provider: string) {
  const name = DEFAULT_MODELS_BY_PROVIDER[provider];
  return name ? { provider, name } : undefined;
}
