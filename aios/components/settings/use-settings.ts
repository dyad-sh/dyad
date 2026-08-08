import { parseAsBoolean, parseAsStringLiteral, useQueryState } from 'nuqs'
import { DEFAULT_MODEL, SUPPORTED_MODELS } from '@/ai/constants'

export function useSettings() {
  const [modelId] = useModelId()
  const [fixErrors] = useFixErrors()
  const [reasoningEffort] = useReasoningEffort()
  return { modelId, fixErrors, reasoningEffort }
}

export function useModelId() {
  return useQueryState(
    'modelId',
    parseAsStringLiteral(SUPPORTED_MODELS.map((model) => model)).withDefault(
      DEFAULT_MODEL
    )
  )
}

export function useReasoningEffort() {
  return useQueryState(
    'effort',
    parseAsStringLiteral(['medium', 'low']).withDefault('low')
  )
}

export function useFixErrors() {
  return useQueryState('fix-errors', parseAsBoolean.withDefault(true))
}
