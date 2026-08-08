import { useState, useEffect, useCallback } from 'react'

interface DisplayModel {
  id: string
  label: string
}

const MAX_RETRIES = 3
const RETRY_DELAY_MILLIS = 5000

export function useAvailableModels() {
  const [models, setModels] = useState<DisplayModel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const fetchModels = useCallback(
    async (isRetry: boolean = false) => {
      if (!isRetry) {
        setIsLoading(true)
        setError(null)
      }

      try {
        const response = await fetch('/api/models')
        if (!response.ok) {
          throw new Error('Failed to fetch models')
        }
        const data = await response.json()
        const newModels = data.models.map(
          (model: { id: string; name: string }) => ({
            id: model.id,
            label: model.name,
          })
        )
        setModels(newModels)
        setError(null)
        setRetryCount(0)
        setIsLoading(false)
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to fetch models')
        )
        if (retryCount < MAX_RETRIES) {
          setRetryCount((prev) => prev + 1)
          setIsLoading(true)
        } else {
          setIsLoading(false)
        }
      } finally {
        setIsLoading(false)
      }
    },
    [retryCount]
  )

  useEffect(() => {
    if (retryCount === 0) {
      fetchModels(false)
    } else if (retryCount > 0 && retryCount <= MAX_RETRIES) {
      const timerId = setTimeout(() => {
        fetchModels(true)
      }, RETRY_DELAY_MILLIS)
      return () => clearTimeout(timerId)
    }
  }, [retryCount, fetchModels])

  return { models, isLoading, error }
}
