import { resultSchema, type Line, type Lines } from './schemas'

export async function getSummary(lines: Line[], previous: Line[]) {
  const response = await fetch('/api/errors', {
    body: JSON.stringify({ lines, previous } satisfies Lines),
    method: 'POST',
  })

  if (!response.ok) {
    return { shouldBeFixed: false, summary: '' } as const
  }

  const body = await response.json()
  return resultSchema.parse(body)
}
