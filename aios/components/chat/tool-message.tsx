import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ToolMessage(props: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'text-sm px-3.5 py-3 border border-border bg-background rounded-md font-mono',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}
