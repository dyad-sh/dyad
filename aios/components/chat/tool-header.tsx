import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ToolHeader(props: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-muted-foreground mb-1 font-semibold',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}
