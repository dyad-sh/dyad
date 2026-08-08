import { useEffect, useState } from 'react'

export function useLocalStorageValue(key: string) {
  const [value, setValue] = useState<string>('')
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    const storedValue = localStorage.getItem(key)
    if (storedValue !== null) {
      setValue(storedValue)
    }
    setIsInitialized(true)
  }, [key])

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(key, value)
    }
  }, [key, value, isInitialized])

  return [value, setValue] as const
}
