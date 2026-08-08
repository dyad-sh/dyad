'use client'

import { MonacoFileViewer } from './monaco-editor'
import { memo } from 'react'
import useSWR from 'swr'

interface Props {
  sandboxId: string
  path: string
}

export const FileContent = memo(function FileContent({ sandboxId, path }: Props) {
  const searchParams = new URLSearchParams({ path })
  const content = useSWR(
    `/api/sandboxes/${sandboxId}/files?${searchParams.toString()}`,
    async (pathname: string) => {
      const response = await fetch(pathname)
      return response.text()
    },
    { refreshInterval: 1000 }
  )

  if (content.isLoading || !content.data) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <div className="holo-loader" />
      </div>
    )
  }

  return <MonacoFileViewer path={path} code={content.data} />
})
