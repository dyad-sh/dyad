import { type GatewayModelId } from '@ai-sdk/gateway'

export enum Models {
  OpenAIGPT53Codex = 'openai/gpt-5.3-codex',
}

export const DEFAULT_MODEL = Models.OpenAIGPT53Codex

export const SUPPORTED_MODELS: GatewayModelId[] = [
  Models.OpenAIGPT53Codex,
]

export const MODEL_NAMES: Record<string, string> = {
  [Models.OpenAIGPT53Codex]: 'GPT-5.3 Codex',
}

export const TEST_PROMPTS = [
  'Generate a Next.js app that allows to list and search Pokemons',
  'Create a `golang` server that responds with "Hello World" to any request',
]
