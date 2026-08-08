import { MODEL_NAMES, SUPPORTED_MODELS } from '@/ai/constants'
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    {
      models: SUPPORTED_MODELS.map((id) => ({
        id,
        name: MODEL_NAMES[id] ?? id,
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
